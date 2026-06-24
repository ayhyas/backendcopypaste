const express = require('express');
const router = express.Router();
const { getWorkspaces, createWorkspace, renameWorkspace, deleteWorkspace, lockWorkspace, removeLock, getLock, verifyLock } = require('../controllers/workspaceController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/', getWorkspaces);
router.post('/', createWorkspace);
router.patch('/:id', renameWorkspace);
router.delete('/:id', deleteWorkspace);
router.patch('/:id/lock', lockWorkspace);
router.delete('/:id/lock', removeLock);
router.get('/:id/lock', getLock);
router.post('/:id/verify', verifyLock);

module.exports = router;
