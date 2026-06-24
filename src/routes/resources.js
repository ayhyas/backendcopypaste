const express = require('express');
const { getResources, createResource, deleteResource } = require('../controllers/resourceController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.get('/',       protect, getResources);
router.post('/',      protect, createResource);
router.delete('/:id', protect, deleteResource);

module.exports = router;
