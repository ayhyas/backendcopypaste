const express = require('express');
const { getDrawings, createDrawing, renameDrawing, deleteDrawing } = require('../controllers/drawingController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.get('/',        protect, getDrawings);
router.post('/',       protect, createDrawing);
router.patch('/:id',   protect, renameDrawing);
router.delete('/:id',  protect, deleteDrawing);

module.exports = router;
