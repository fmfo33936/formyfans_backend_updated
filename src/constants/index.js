const INTERESTS = {
  SKIN_CARE: "skin_care",
  BEAUTY: "beauty",
  FASHION: "fashion",
  FITNESS: "fitness",
  WELLNESS: "wellness",
  TRAVEL: "travel",
  LIFESTYLE: "lifestyle",
  FOOD: "food",
  TECH: "tech",
  GAMING: "gaming",
  PARENTING: "parenting",
  LUXURY: "luxury",
  HOME_DECOR: "home_decor",
  PHOTOGRAPHY: "photography",
  MUSIC: "music",
  SUSTAINABILITY: "sustainability",
};

const ROLE = {
  USER: "user",
  CREATOR: "creator",
};

const GENDER = {
  MALE: "male",
  FEMALE: "female",
  PREFER_NOT_TO_SAY: "prefer_not_to_say",
};

const ACCOUNT_TYPE = {
  PERSONAL: "personal",
  BUSINES: "business",
};

const ACCOUNT_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
};

const CAMPAIGN_DEFAULT_RADIUS_KM = 50;
const CAMPAIGN_FEED_INTERVAL = Number(process.env.CAMPAIGN_FEED_INTERVAL) || 5;
const CAMPAIGN_MAX_RADIUS_KM = 500;

module.exports = {
  ROLE,
  INTERESTS,
  GENDER,
  ACCOUNT_TYPE,
  ACCOUNT_STATUS,
  CAMPAIGN_DEFAULT_RADIUS_KM,
  CAMPAIGN_FEED_INTERVAL,
  CAMPAIGN_MAX_RADIUS_KM,
};
