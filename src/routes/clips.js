const express = require('express');
const router = express.Router();
const { getClips, createClip, updateClip, deleteClip } = require('../controllers/clipController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/', getClips);
router.post('/', createClip);
router.patch('/:id', updateClip);
router.delete('/:id', deleteClip);

module.exports = router;
