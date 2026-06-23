const express = require('express');
const router = express.Router();
const { getWorkspaces, createWorkspace, renameWorkspace, deleteWorkspace } = require('../controllers/workspaceController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/', getWorkspaces);
router.post('/', createWorkspace);
router.patch('/:id', renameWorkspace);
router.delete('/:id', deleteWorkspace);

module.exports = router;
