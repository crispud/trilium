"use strict";

const express = require('express');
const router = express.Router();
const auth = require('../../services/auth');
const sync = require('../../services/sync');
const syncUpdate = require('../../services/sync_update');
const sql = require('../../services/sql');
const options = require('../../services/options');
const content_hash = require('../../services/content_hash');
const utils = require('../../services/utils');
const log = require('../../services/log');

router.get('/check', auth.checkApiAuth, async (req, res, next) => {
    res.send({
        'hashes': await content_hash.getHashes(),
        'max_sync_id': await sql.getSingleValue('SELECT MAX(id) FROM sync')
    });
});

router.post('/now', auth.checkApiAuth, async (req, res, next) => {
    res.send(await sync.sync());
});

async function fillSyncRows(entityName, entityKey) {
    // cleanup sync rows for missing entities
    await sql.execute(`
      DELETE 
      FROM sync 
      WHERE sync.entity_name = '${entityName}' 
        AND sync.entity_id NOT IN (SELECT ${entityKey} FROM ${entityName})`);

    const entityIds = await sql.getFlattenedResults(`SELECT ${entityKey} FROM ${entityName}`);

    for (const entityId of entityIds) {
        const existingRows = await sql.getSingleValue("SELECT COUNT(id) FROM sync WHERE entity_name = ? AND entity_id = ?", [entityName, entityId]);

        // we don't want to replace existing entities (which would effectively cause full resync)
        if (existingRows === 0) {
            log.info(`Creating missing sync record for ${entityName} ${entityId}`);

            await sql.insert("sync", {
                entity_name: entityName,
                entity_id: entityId,
                source_id: "SYNC_FILL",
                sync_date: utils.nowDate()
            });
        }
    }
}

router.post('/fill-sync-rows', auth.checkApiAuth, async (req, res, next) => {
    await sql.doInTransaction(async () => {
        await fillSyncRows("notes", "note_id");
        await fillSyncRows("notes_tree", "note_tree_id");
        await fillSyncRows("notes_history", "note_history_id");
        await fillSyncRows("recent_notes", "note_tree_id");
    });

    res.send({});
});

router.post('/force-full-sync', auth.checkApiAuth, async (req, res, next) => {
    await sql.doInTransaction(async () => {
        await options.setOption('last_synced_pull', 0);
        await options.setOption('last_synced_push', 0);
    });

    // not awaiting for the job to finish (will probably take a long time)
    sync.sync();

    res.send({});
});

router.get('/changed', auth.checkApiAuth, async (req, res, next) => {
    const lastSyncId = parseInt(req.query.lastSyncId);

    res.send(await sql.getResults("SELECT * FROM sync WHERE id > ?", [lastSyncId]));
});

router.get('/notes/:noteId', auth.checkApiAuth, async (req, res, next) => {
    const noteId = req.params.noteId;

    res.send({
        entity: await sql.getSingleResult("SELECT * FROM notes WHERE note_id = ?", [noteId])
    });
});

router.get('/notes_tree/:noteTreeId', auth.checkApiAuth, async (req, res, next) => {
    const noteTreeId = req.params.noteTreeId;

    res.send(await sql.getSingleResult("SELECT * FROM notes_tree WHERE note_tree_id = ?", [noteTreeId]));
});

router.get('/notes_history/:noteHistoryId', auth.checkApiAuth, async (req, res, next) => {
    const noteHistoryId = req.params.noteHistoryId;

    res.send(await sql.getSingleResult("SELECT * FROM notes_history WHERE note_history_id = ?", [noteHistoryId]));
});

router.get('/options/:optName', auth.checkApiAuth, async (req, res, next) => {
    const optName = req.params.optName;

    if (!options.SYNCED_OPTIONS.includes(optName)) {
        res.send("This option can't be synced.");
    }
    else {
        res.send(await sql.getSingleResult("SELECT * FROM options WHERE opt_name = ?", [optName]));
    }
});

router.get('/notes_reordering/:noteTreeParentId', auth.checkApiAuth, async (req, res, next) => {
    const noteTreeParentId = req.params.noteTreeParentId;

    res.send({
        parent_note_id: noteTreeParentId,
        ordering: await sql.getMap("SELECT note_tree_id, note_position FROM notes_tree WHERE parent_note_id = ?", [noteTreeParentId])
    });
});

router.get('/recent_notes/:noteTreeId', auth.checkApiAuth, async (req, res, next) => {
    const noteTreeId = req.params.noteTreeId;

    res.send(await sql.getSingleResult("SELECT * FROM recent_notes WHERE note_tree_id = ?", [noteTreeId]));
});

router.put('/notes', auth.checkApiAuth, async (req, res, next) => {
    await syncUpdate.updateNote(req.body.entity, req.body.sourceId);

    res.send({});
});

router.put('/notes_tree', auth.checkApiAuth, async (req, res, next) => {
    await syncUpdate.updateNoteTree(req.body.entity, req.body.sourceId);

    res.send({});
});

router.put('/notes_history', auth.checkApiAuth, async (req, res, next) => {
    await syncUpdate.updateNoteHistory(req.body.entity, req.body.sourceId);

    res.send({});
});

router.put('/notes_reordering', auth.checkApiAuth, async (req, res, next) => {
    await syncUpdate.updateNoteReordering(req.body.entity, req.body.sourceId);

    res.send({});
});

router.put('/options', auth.checkApiAuth, async (req, res, next) => {
    await syncUpdate.updateOptions(req.body.entity, req.body.sourceId);

    res.send({});
});

router.put('/recent_notes', auth.checkApiAuth, async (req, res, next) => {
    await syncUpdate.updateRecentNotes(req.body.entity, req.body.sourceId);

    res.send({});
});

module.exports = router;