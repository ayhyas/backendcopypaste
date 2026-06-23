const mongoose = require('mongoose');

const CLIP_TYPES = ['text', 'code', 'image', 'link', 'file'];

const clipSchema = new mongoose.Schema(
  {
    content: {
      type: String,
      required: [true, 'Content is required'],
    },
    type: {
      type: String,
      enum: { values: CLIP_TYPES, message: 'Invalid clip type' },
      required: true,
      default: 'text',
    },
    language: {
      type: String,
      default: null,
    },
    fileName: {
      type: String,
      default: null,
    },
    mimeType: {
      type: String,
      default: null,
    },
    fileSize: {
      type: Number,
      default: null,
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    authorName: {
      type: String,
      required: true,
    },
    workspace: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      default: null,
    },
    title: {
      type: String,
      default: null,
      trim: true,
      maxlength: 100,
    },
  },
  { timestamps: true }
);

clipSchema.index({ createdAt: -1 });
clipSchema.index({ author: 1, createdAt: -1 });

module.exports = mongoose.model('Clip', clipSchema);
