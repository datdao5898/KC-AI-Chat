const MAX_FEEDBACK_LENGTH = 500;

function normalizeRating(value) {
  const rating = Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return null;
  return rating;
}

function normalizeRatingFeedback(value) {
  return String(value || '').trim().slice(0, MAX_FEEDBACK_LENGTH);
}

module.exports = {
  MAX_FEEDBACK_LENGTH,
  normalizeRating,
  normalizeRatingFeedback
};
