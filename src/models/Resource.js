const mongoose = require('mongoose');

const resourceSchema = new mongoose.Schema({
  type:       { type: String, enum: ['image', 'text'], required: true },
  name:       { type: String, default: '', maxlength: 100, trim: true },
  content:    { type: String, required: true }, // base64 data URL (image) or plain text
  workspace:  { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', default: null },
  author:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  authorName: { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.model('Resource', resourceSchema);
