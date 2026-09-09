module.exports = {
  blog: "me-yanke",
  consumerKey: process.env.TUMBLR_CONSUMER_KEY,
  transform: tags => tags.filter(tag => tag.count > 1)
};
