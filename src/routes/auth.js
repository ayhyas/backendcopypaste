const express = require('express');
const router = express.Router();
const { register, login, getMe, updateProfilePic } = require('../controllers/authController');
const { protect } = require('../middleware/auth');

router.post('/register', register);
router.post('/login', login);
router.get('/me', protect, getMe);
router.patch('/profile-pic', protect, updateProfilePic);

module.exports = router;
