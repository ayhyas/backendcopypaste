const jwt = require('jsonwebtoken');
const User = require('../models/User');

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'yahya';

const sendTokenResponse = (user, statusCode, res) => {
  const token = signToken(user._id);
  res.status(statusCode).json({
    success: true,
    token,
    user: {
      id:         user._id,
      username:   user.username,
      email:      user.email,
      profilePic: user.profilePic || null,
      role:       user.role,
    },
  });
};

exports.register = async (req, res, next) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide username, email, and password',
      });
    }

    const user = await User.create({ username, email, password });

    // Promote on first registration if this is the designated admin username
    if (user.username === ADMIN_USERNAME && user.role !== 'admin') {
      user.role = 'admin';
      await user.save();
    }

    sendTokenResponse(user, 201, res);
  } catch (error) {
    next(error);
  }
};

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password',
      });
    }

    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // Auto-promote the designated admin account
    if (user.username === ADMIN_USERNAME && user.role !== 'admin') {
      user.role = 'admin';
      await user.save();
    }

    sendTokenResponse(user, 200, res);
  } catch (error) {
    next(error);
  }
};

exports.getMe = async (req, res) => {
  res.json({
    success: true,
    user: {
      id:         req.user._id,
      username:   req.user.username,
      email:      req.user.email,
      profilePic: req.user.profilePic || null,
      role:       req.user.role,
    },
  });
};

exports.updateProfilePic = async (req, res, next) => {
  try {
    const { profilePic } = req.body;

    if (!profilePic) {
      return res.status(400).json({ success: false, message: 'No image provided' });
    }
    if (!profilePic.startsWith('data:image/')) {
      return res.status(400).json({ success: false, message: 'Invalid image format' });
    }
    if (profilePic.length > 512 * 1024) {
      return res.status(400).json({ success: false, message: 'Image too large (max 384 KB)' });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { profilePic },
      { new: true }
    );

    // Keep the online users panel in sync for live sessions
    req.updateOnlineUserPic?.(req.user._id, profilePic);
    // Broadcast so all clients can update clip-card author avatars live
    req.io.emit('user:profilePic', { username: user.username, profilePic });

    res.json({
      success: true,
      user: {
        id:         user._id,
        username:   user.username,
        email:      user.email,
        profilePic: user.profilePic,
      },
    });
  } catch (error) {
    next(error);
  }
};
