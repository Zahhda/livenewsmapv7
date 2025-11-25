import mongoose from 'mongoose';

const NewsItemSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true }, // dedupe key from link/title+date
  regionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Region', index: true, required: true },
  title: { type: String, default: '' },
  summary: { type: String, default: '' },
  link: { type: String, default: '' },
  isoDate: { type: Date, index: true },
  source: { type: String, default: '' },
  category: { type: String, default: 'others' },
  image: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now, index: true }
});

NewsItemSchema.index({ regionId: 1, isoDate: -1 });

export default mongoose.model('NewsItem', NewsItemSchema);