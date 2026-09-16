const OWN_PRODUCT_MESSAGE = "You cannot purchase your own products";

const isCreatorBuyingOwnProduct = (user, creatorId) =>
  user?.role === "creator"
  && creatorId != null
  && String(creatorId) === String(user._id);

module.exports = {
  OWN_PRODUCT_MESSAGE,
  isCreatorBuyingOwnProduct,
};
