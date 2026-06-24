const mongoose = require('mongoose');

const workspaceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 50 },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    ownerName: { type: String, required: true },
    lockPassword: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Workspace', workspaceSchema);
