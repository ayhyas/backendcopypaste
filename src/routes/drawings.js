const express = require('express');
const { getDrawings, createDrawing, deleteDrawing } = require('../controllers/drawingController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.get('/',    protect, getDrawings);
router.post('/',   protect, createDrawing);
router.delete('/:id', protect, deleteDrawing);

module.exports = router;
