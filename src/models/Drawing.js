const mongoose = require('mongoose');

const drawingSchema = new mongoose.Schema(
  {
    title:      { type: String, default: 'Untitled', maxlength: 100, trim: true },
    author:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    authorName: { type: String, required: true },
    workspace:  { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', default: null },
    elements:   { type: String, required: true }, // JSON-serialised element array
    preview:    { type: String, required: true },  // base64 JPEG data URL (compressed)
  },
  { timestamps: true }
);

module.exports = mongoose.model('Drawing', drawingSchema);
