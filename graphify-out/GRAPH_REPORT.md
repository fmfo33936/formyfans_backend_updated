# Graph Report - formyfans_backend_updated  (2026-09-29)

## Corpus Check
- 177 files · ~76,134 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1575 nodes · 2875 edges · 160 communities (82 shown, 77 thin omitted)
- Extraction: 89% EXTRACTED · 11% INFERRED · 0% AMBIGUOUS · INFERRED: 319 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `321ee18b`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- engagementHelper.js
- pathlib
- controllers/exclusiveContent.js
- controllers/boost.js
- hashlib
- http_client
- posixpath
- controllers/admin.js
- controllers/auth.js
- analytics.js
- user.js
- controllers/post.js
- controllers/ai.js
- campaignEngagement.js
- controllers/deal.js
- controllers/favourite.js
- networkx
- array
- math
- schemaValidator
- helper.js
- controllers/order.js
- campaignTargeting.js
- parsePagination
- controllers/follow.js
- creditService.js
- boostLifecycle.js
- controllers/campaignCategory.js
- middlewares/auth.js
- controllers/stripe.js
- validations.js
- Project Overview: FormyFans Backend
- routes/index.js
- models/auth.js
- controllers/campaign.js
- routes/post.js
- aiJobQueue.js
- controllers/product.js
- argparse
- errno
- getStripe
- controllers/cart.js
- orderPayment.js
- controllers/subscription.js
- openaiService.js
- models/conversation.js
- controllers/creatorSubscription.js
- routes/activityLog.js
- controllers/liveStream.js
- routes/order.js
- models/post.js
- controllers/payout.js
- migrateCloudinaryToS3.js
- backfill-product-ids.js
- middlewares/admin.js
- createCommentOnTarget
- routes/conversation.js
- copy
- logger.js
- controllers/liveStreamPayment.js
- socialHelpers.js
- validator.js
- controllers/review.js
- emailService.js
- socket.js
- routes/ai.js
- xml_etree_elementtree
- routes/message.js
- update-graphify.js
- models/campaignCategory.js
- utils/stripe.js
- models/message.js
- enrichProductRefs.js
- productPricing.js
- models/comment.js
- generationMessages.js
- hashOtp
- numpy
- models/admin.js
- orderId.js
- server.js
- otpModel.js
- storyView.js
- rapidfuzz_distance
- subprocess
- models/subscriptionPlans.js
- dependencies
- routes/notification.js
- userSubscription.js
- @aws-sdk/s3-request-presigner
- axios
- bcryptjs
- controllers/card.js
- cors
- concurrent_futures
- collections
- dotenv
- ejs
- base64
- helmet
- livekit-server-sdk
- mongoose
- scripts
- socket.io
- uuid
- importlib
- importlib_metadata
- s3MediaService.js
- inspect
- io
- ipaddress
- package.json
- jieba
- aiGenerationService.js
- AIJobQueue
- json
- logging
- networkx_readwrite
- os
- platform
- dataclasses
- collections_abc
- re
- subscriptionPlan.js
- app.js
- controllers/campaignObjective.js
- ref_node_fs
- ref_node_path
- ref_node_test
- ref_node_url
- shlex
- fnmatch
- shutil
- stat
- struct
- sys
- tempfile
- textwrap
- ref_node_assert
- threading
- time
- functools
- typing
- unicodedata
- urllib_error
- urllib_parse
- urllib_request
- warnings
- test-ai-system.js
- models/fanSubscription.js
- CreditService
- contextlib
- create-internal-users.js
- MagicaService
- models/order.js
- atexit
- ast
- S3MediaService
- liveStreamHandlers.js

## God Nodes (most connected - your core abstractions)
1. `schemaValidator()` - 70 edges
2. `getStripe()` - 46 edges
3. `parsePagination()` - 42 edges
4. `logActivity()` - 31 edges
5. `verifyUser()` - 30 edges
6. `successHelper()` - 19 edges
7. `errorHelper()` - 18 edges
8. `dollarsToCents()` - 16 edges
9. `centsToDollars()` - 15 edges
10. `MagicaService` - 14 edges

## Surprising Connections (you probably didn't know these)
- `bulkCreateInternalUsers()` --calls--> `getStripe()`  [EXTRACTED]
  scripts/create-internal-users.js → src/utils/stripe.js
- `run()` --calls--> `generateUniqueUsername()`  [EXTRACTED]
  scripts/generate-username.js → src/utils/helper.js
- `startServer()` --calls--> `initializeSocket()`  [EXTRACTED]
  server.js → src/socket/socket.js
- `run()` --calls--> `formatOrderId()`  [EXTRACTED]
  scripts/backfill-order-ids.js → src/utils/orderId.js
- `run()` --calls--> `parseSeqFromOrderId()`  [EXTRACTED]
  scripts/backfill-order-ids.js → src/utils/orderId.js

## Import Cycles
- None detected.

## Communities (160 total, 77 thin omitted)

### Community 0 - "engagementHelper.js"
Cohesion: 0.08
Nodes (30): { schemaValidator }, sharePost(), { sharePostSchema }, { shareTarget }, ENGAGEMENT_TARGET_TYPES, mongoose, ShareSchema, {
  AUTHOR_FIELDS,
  parsePagination,
  buildPagination,
  sanitizeAuthor,
} (+22 more)

### Community 2 - "controllers/exclusiveContent.js"
Cohesion: 0.10
Nodes (29): {
  AUTHOR_FIELDS,
  parsePagination,
  assertOwner,
  sanitizeAuthor,
  isLikedByUser,
}, { buildAggregatePagination }, Comment, createExclusiveContent(), {
  createExclusiveContentSchema,
  updateExclusiveContentSchema,
}, deleteExclusiveContent(), ExclusiveContent, formatExclusiveContent() (+21 more)

### Community 3 - "controllers/boost.js"
Cohesion: 0.08
Nodes (27): trackWebsiteClick(), Boost, BoostAnalytics, BoostError, { calculateReach }, createBoost(), {
  estimateBoostReachSchema,
  createBoostSchema,
}, estimateReach() (+19 more)

### Community 7 - "controllers/admin.js"
Cohesion: 0.12
Nodes (27): Admin, bcrypt, buildAdminToken(), changePassword(), createAdmin(), EmailService, forgotPassword(), { generateOtp, hashOtp, verifyLoginPassword } (+19 more)

### Community 8 - "controllers/auth.js"
Cohesion: 0.09
Nodes (25): bcrypt, EmailService, FavouriteModel, FollowModel, forgotPassword(), {
  generateOtp,
  hashOtp,
  generateUniqueUsername,
  escapeRegex,
  verifyLoginPassword,
}, { getStripe, dollarsToCents }, jwt (+17 more)

### Community 9 - "analytics.js"
Cohesion: 0.10
Nodes (19): Boost, BoostAnalytics, calcBudgetSpent(), getCreatorBoostAnalytics(), getPostAnalytics(), mongoose, Post, PostAnalytics (+11 more)

### Community 10 - "user.js"
Cohesion: 0.14
Nodes (22): buildUserToken(), changePassword(), checkUsernameAvailability(), createCreator(), createUser(), getProfile(), getProfileByUsername(), loginByUsername() (+14 more)

### Community 11 - "controllers/post.js"
Cohesion: 0.10
Nodes (23): {
  AUTHOR_FIELDS,
  parsePagination,
  assertOwner,
  sanitizeAuthor,
  isLikedByUser,
}, { buildAggregatePagination, escapeRegex }, Comment, { createPostSchema, updatePostSchema }, Deal, {
  enrichPostsWithBoosts,
  getActiveBoostForPost,
  getActiveBoostItemsForUser,
  interleaveBoostItemsIntoFeed,
}, Follow, formatPost() (+15 more)

### Community 12 - "controllers/ai.js"
Cohesion: 0.12
Nodes (19): aiGenerationService, AIPrompt, AIUsage, createGeneration(), editVideo(), generateImage(), generateVideo(), listGenerations() (+11 more)

### Community 13 - "campaignEngagement.js"
Cohesion: 0.11
Nodes (29): createCampaignComment(), deleteCampaignComment(), getCampaignComments(), getCampaignLikes(), Joi, likeCampaign(), {
  likeTarget,
  unlikeTarget,
  listLikes,
  createCommentOnTarget,
  deleteCommentOnTarget,
  listComments,
  shareTarget,
}, { schemaValidator } (+21 more)

### Community 14 - "controllers/deal.js"
Cohesion: 0.09
Nodes (30): acceptDeal(), addReview(), adminVerifyIncompleteDeal(), buildSharedDealPayload(), ConversationModel, createDeal(), {
  createDealSchema,
  dealPaymentSchema,
  dealReviewSchema,
  adminVerifyIncompleteDealSchema,
}, { createNotification } (+22 more)

### Community 15 - "controllers/favourite.js"
Cohesion: 0.09
Nodes (22): addFavourite(), { addFavouriteSchema }, { buildPagination }, { createNotification }, FavouriteModel, { logActivity }, mongoose, { parsePagination } (+14 more)

### Community 19 - "schemaValidator"
Cohesion: 0.14
Nodes (28): directUpload(), getGeneration(), getRefinedPrompt(), presignUpload(), refinePrompt(), AIPaymentHistory, calculatePrice(), createPurchasePaymentIntent() (+20 more)

### Community 20 - "helper.js"
Cohesion: 0.13
Nodes (11): ref_crypto, { generateUniqueUsername }, missingUsernameFilter, mongoose, run(), User, suggestUsername(), bcrypt (+3 more)

### Community 21 - "controllers/order.js"
Cohesion: 0.12
Nodes (25): buildOrderDetailResponse(), buildOrderDetails(), createOrder(), { enrichOrder, enrichOrders }, { findProductsByProductIds }, formatBuyer(), formatLineItems(), formatPaymentForShop() (+17 more)

### Community 22 - "campaignTargeting.js"
Cohesion: 0.15
Nodes (15): src_constants_index_campaign_default_radius_km, src_constants_index_campaign_feed_interval, src_constants_index_campaign_max_radius_km, followSchema, mongoose, Campaign, {
  CAMPAIGN_DEFAULT_RADIUS_KM,
  CAMPAIGN_FEED_INTERVAL,
  CAMPAIGN_MAX_RADIUS_KM,
}, Follow (+7 more)

### Community 23 - "parsePagination"
Cohesion: 0.17
Nodes (15): cancelDeal(), getAllDealsForAdminDashboard(), getCancelledOrPausedDeals(), getCompletedDeals(), getDealById(), getDealsInProgress(), getReceivedDeals(), getReceivedDealsInStartStatus() (+7 more)

### Community 24 - "controllers/follow.js"
Cohesion: 0.09
Nodes (27): getAllCreators(), { createNotification }, { escapeRegex }, Follow, FollowSuggestionDismiss, followUser(), { followUserSchema }, getFollowers() (+19 more)

### Community 25 - "creditService.js"
Cohesion: 0.12
Nodes (13): aiPaymentHistorySchema, mongoose, creditPricingSchema, mongoose, creditTransactionSchema, mongoose, AIPaymentHistory, CreditPricing (+5 more)

### Community 26 - "boostLifecycle.js"
Cohesion: 0.15
Nodes (16): { AUTHOR_FIELDS }, Boost, checkAudienceMatch(), expireDueBoosts(), Follow, getActiveBoostItemsForUser(), { getLikedTargetIds }, { getUserAgeYears } (+8 more)

### Community 27 - "controllers/campaignCategory.js"
Cohesion: 0.17
Nodes (14): CampaignCategory, createCampaignCategory(), {
  createCampaignCategorySchema,
  updateCampaignCategorySchema,
}, deleteCampaignCategory(), getCampaignCategories(), getCampaignCategoryById(), { parsePagination }, { schemaValidator } (+6 more)

### Community 28 - "middlewares/auth.js"
Cohesion: 0.27
Nodes (10): Admin, { errorHelper }, getTokenFromHeader(), jwt, optionalVerifyUser(), User, verifyContentCreator(), verifyUser() (+2 more)

### Community 29 - "controllers/stripe.js"
Cohesion: 0.15
Nodes (20): Campaign, FanPaymentHistory, FanSubscription, { findOrderByOrderId }, {
  getStripe,
  dollarsToCents,
  centsToDollars,
  getSubscriptionPeriod,
  stripeTimestampToDate,
  getFeeBreakdownFromPaymentIntent,
}, handleCreatorInvoicePaid(), handleCreatorInvoicePaymentFailed(), handleCreatorSubscriptionDeleted() (+12 more)

### Community 30 - "validations.js"
Cohesion: 0.12
Nodes (15): advertisementSchema, boostAudienceSchema, calculateCreditPriceSchema, checkUsernameAvailabilitySchema, deliverableSchema, Joi, purchaseCreditsSchema, { ROLE, GENDER, INTERESTS } (+7 more)

### Community 31 - "Project Overview: FormyFans Backend"
Cohesion: 0.13
Nodes (14): 1. Module Structure, 2. Validation Pattern, 3. Authentication & Authorization (RBAC), 4. Response Handling, Caveman Mode (Output Token Reduction), Context & Token Optimization: Caveman + Graphify, Core Models, Development Patterns & Runtime (+6 more)

### Community 32 - "routes/index.js"
Cohesion: 0.06
Nodes (34): activityLogRoutes, adminRoutes, adminSettingsRoutes, aiRoutes, Auth, authRoutes, boostRoutes, campaignCategoryRoutes (+26 more)

### Community 33 - "models/auth.js"
Cohesion: 0.07
Nodes (30): ACCOUNT_STATUS, ACCOUNT_TYPE, GENDER, INTERESTS, ROLE, deleteMedia(), getMediaByUsername(), { logActivity } (+22 more)

### Community 34 - "controllers/campaign.js"
Cohesion: 0.08
Nodes (32): stripeCreateClientSecret(), calculateCampaignEstimatedReach(), Campaign, CampaignCategory, CampaignObjective, confirmCampaignPayment(), createCampaign(), {
  createCampaignSchema,
  updateCampaignSchema,
  campaignEstimatedReachSchema,
} (+24 more)

### Community 35 - "routes/post.js"
Cohesion: 0.15
Nodes (14): trackProfileVisit(), getSheduledPost(), getUpcomingScheduledPosts(), getUserPostsByUsername(), {
  createComment,
  deleteComment,
  getPostComments,
}, {
  createPost,
  updatePost,
  deletePost,
  getAllPosts,
  getUserPostsByUsername,
  getPostById,
  getSheduledPost,
  getUpcomingScheduledPosts,
  searchTaggableUsers,
}, express, { likePost, unlikePost, getPostLikes } (+6 more)

### Community 36 - "aiJobQueue.js"
Cohesion: 0.13
Nodes (13): aiUsageSchema, mongoose, AIContent, AIGeneration, AIUsage, creditService, CreditTransaction, generationMessages (+5 more)

### Community 37 - "controllers/product.js"
Cohesion: 0.15
Nodes (22): assertCreatorOwnsProduct(), deleteProduct(), {
  formatProductResponse,
  formatProductsResponse,
}, {
  getNextProductId,
  findProductByProductId,
}, getProductById(), getProductsByCreator(), listProducts(), {
  parseDiscount,
  parseDeliveryCharges,
} (+14 more)

### Community 40 - "getStripe"
Cohesion: 0.18
Nodes (16): cancelCreatorSubscription(), confirmCreatorSubscription(), CreatorSubscriptionModel, FanSubscriptionModel, getCreatorSubscriptionStatus(), getOrCreateStripeCustomer(), {
  getStripe,
  getSubscriptionPeriod,
  stripeTimestampToDate,
  centsToDollars,
}, initiateCreatorSubscription() (+8 more)

### Community 41 - "controllers/cart.js"
Cohesion: 0.17
Nodes (18): addToCart(), Cart, clearCart(), { enrichCartItems }, { findProductByProductId }, getCart(), {
  OWN_PRODUCT_MESSAGE,
  isCreatorBuyingOwnProduct,
}, removeCartItem() (+10 more)

### Community 42 - "orderPayment.js"
Cohesion: 0.27
Nodes (15): apiPaymentStatus(), applyPaymentIntentToOrder(), confirmPayment(), createClientSecret(), createPaymentIntentForOrder(), EmailService, getOrderPaymentDetails(), {
  getStripe,
  dollarsToCents,
  centsToDollars,
} (+7 more)

### Community 43 - "controllers/subscription.js"
Cohesion: 0.11
Nodes (22): buySubscription(), { buySubscriptionSchema }, cancelSubscription(), createSubscriptionForInternalUsers(), getCurrentSubscription(), getOrCreateStripeCustomer(), getPaymentHistory(), {
  getStripe,
  getSubscriptionPeriod,
  stripeTimestampToDate,
  centsToDollars,
} (+14 more)

### Community 44 - "openaiService.js"
Cohesion: 0.32
Nodes (3): axios, logger, OpenAIService

### Community 45 - "models/conversation.js"
Cohesion: 0.25
Nodes (7): Conversation, ConversationSchema, lastMessageSchema, mongoose, chatHandlers(), Conversation, Message

### Community 46 - "controllers/creatorSubscription.js"
Cohesion: 0.14
Nodes (12): { createCreatorSubscriptionSchema }, CreatorSubscriptionModel, FansSubscriptionModel, getCreatorSubscriptionPrice(), getFanSubsribedOrNot(), {
  getStripe,
  getSubscriptionPeriod,
  stripeTimestampToDate,
  centsToDollars,
}, { schemaValidator }, setCreatorSubscriptionPrice() (+4 more)

### Community 47 - "routes/activityLog.js"
Cohesion: 0.17
Nodes (10): ActivityLogModel, getUserActivityLogs(), mongoose, { parsePagination }, ActivityLogSchema, mongoose, express, { getUserActivityLogs } (+2 more)

### Community 48 - "controllers/liveStream.js"
Cohesion: 0.10
Nodes (28): {
  AccessToken,
  RoomServiceClient,
}, createCommentSchema, createJoinToken(), createLiveStream(), createLiveStreamComment(), createStreamSchema, Deal, endLiveStream() (+20 more)

### Community 49 - "routes/order.js"
Cohesion: 0.20
Nodes (14): formatShopOrderForCreator(), getAllOrders(), getCreatorShopOrders(), getUserOrders(), normalizeOrderStatus(), updateOrderStatus(), {
  createOrder,
  getUserOrders,
  getCreatorShopOrders,
  getAllOrders,
  getOrderById,
  cancelOrder,
  updateOrderStatus,
}, express (+6 more)

### Community 50 - "models/post.js"
Cohesion: 0.17
Nodes (10): cron, { logActivity }, logger, Post, publishScheduledPosts(), startScheduledPostCron(), mediaItemSchema, mongoose (+2 more)

### Community 51 - "controllers/payout.js"
Cohesion: 0.07
Nodes (32): AdminSettings, createAdminSettings(), getAdminSettings(), updateAdminSettings(), checkStripeOnboardingStatus(), connectVendorStripe(), Deal, FanPaymentHistory (+24 more)

### Community 52 - "migrateCloudinaryToS3.js"
Cohesion: 0.18
Nodes (9): ref_dns, axios, dns, Message, mongoose, path, { PutObjectCommand }, s3Client (+1 more)

### Community 53 - "backfill-product-ids.js"
Cohesion: 0.10
Nodes (21): Cart, Counter, { formatProductId, parseSeqFromProductId }, isObjectIdString(), mongoose, Order, Product, run() (+13 more)

### Community 54 - "middlewares/admin.js"
Cohesion: 0.22
Nodes (9): Admin, getTokenFromHeader(), jwt, verifyAdmin(), creditsController, express, router, { verifyAdmin } (+1 more)

### Community 55 - "createCommentOnTarget"
Cohesion: 0.31
Nodes (9): createComment(), {
  createCommentOnTarget,
  deleteCommentOnTarget,
  listComments,
}, deleteComment(), getPostComments(), buildCommentFilter(), createCommentOnTarget(), deleteCommentOnTarget(), formatComment() (+1 more)

### Community 56 - "routes/conversation.js"
Cohesion: 0.24
Nodes (8): BoostAnalytics, Conversation, createConversation(), getConversationByUserId(), {
    createConversation,
    getConversationByUserId,
}, express, router, { verifyUser }

### Community 58 - "logger.js"
Cohesion: 0.20
Nodes (9): cron, expireBoosts(), { expireDueBoosts }, logger, startExpireBoostsCron(), axios, logger, formatArgs() (+1 more)

### Community 59 - "controllers/liveStreamPayment.js"
Cohesion: 0.19
Nodes (14): confirmFanbug(), createFanbugIntent(), {
  createFanbugIntentSchema,
  confirmFanbugSchema,
}, findActiveStream(), formatFanbugComment(), {
  getStripe,
  dollarsToCents,
  centsToDollars,
  getChargeWithBalanceTransaction,
}, LiveStream, LiveStreamComment (+6 more)

### Community 60 - "socialHelpers.js"
Cohesion: 0.05
Nodes (43): getMyFavourites(), {
  AUTHOR_FIELDS,
  parsePagination,
  buildPagination,
  isLikedByUser,
  sanitizeAuthor,
}, { enrichPostsWithBoosts }, Follow, formatFeedPost(), getFollowingFeed(), Post, activeStoryFilter() (+35 more)

### Community 61 - "validator.js"
Cohesion: 0.20
Nodes (8): dismissFollowSuggestion(), { dismissFollowSuggestionSchema }, FollowModel, FollowSuggestionDismissModel, { schemaValidator }, UserModel, dismissFollowSuggestionSchema, validationOptions

### Community 62 - "controllers/review.js"
Cohesion: 0.20
Nodes (8): getReviewsByCreatorId(), mongoose, { parsePagination }, ReviewModel, UserModel, mongoose, REVIEW_TARGET, reviewSchema

### Community 63 - "emailService.js"
Cohesion: 0.25
Nodes (5): ref_path, ejs, EmailService, nodemailer, path

### Community 64 - "socket.js"
Cohesion: 0.28
Nodes (6): chatHandlers, initializeSocket(), jwt, liveStreamHandlers, logger, User

### Community 65 - "routes/ai.js"
Cohesion: 0.40
Nodes (4): aiController, express, router, { verifyUser }

### Community 67 - "routes/message.js"
Cohesion: 0.29
Nodes (6): getAllMessagesForUser(), Message, express, {
    getAllMessagesForUser,
}, router, { verifyUser }

### Community 68 - "update-graphify.js"
Cohesion: 0.29
Nodes (5): ref_child_process, ref_fs, { execSync }, fs, path

### Community 70 - "utils/stripe.js"
Cohesion: 0.48
Nodes (6): handleSubscriptionUpdated(), confirmSubscriptionSetup(), createSubscription(), getSubscriptionPeriod(), Stripe, stripeTimestampToDate()

### Community 71 - "models/message.js"
Cohesion: 0.29
Nodes (6): Message, MessageSchema, mongoose, sharedCampaignSchema, sharedDealSchema, sharedPostSchema

### Community 72 - "enrichProductRefs.js"
Cohesion: 0.50
Nodes (4): buildProductMap(), { findProductsByProductIds }, { formatProductResponse }, findProductsByProductIds()

### Community 73 - "productPricing.js"
Cohesion: 0.32
Nodes (11): assertActiveSubscription(), createProduct(), normalizeVariants(), updateProduct(), computeDiscountedSubtotal(), parseDeliveryCharges(), parseDiscount(), resolveLineDiscountPct() (+3 more)

### Community 74 - "models/comment.js"
Cohesion: 0.50
Nodes (3): commentSchema, ENGAGEMENT_TARGET_TYPES, mongoose

### Community 75 - "generationMessages.js"
Cohesion: 0.67
Nodes (3): COPY, forProgress(), forType()

### Community 76 - "hashOtp"
Cohesion: 0.67
Nodes (3): verifyOtp(), resetPassword(), hashOtp()

### Community 79 - "orderId.js"
Cohesion: 0.17
Nodes (14): Counter, { formatOrderId, parseSeqFromOrderId }, mongoose, Order, run(), cancelOrder(), Counter, findOrderByOrderId() (+6 more)

### Community 80 - "server.js"
Cohesion: 0.12
Nodes (17): ref_http, aiJobQueue, app, defaultEnvPath, devEnvPath, dotenv, fs, http (+9 more)

### Community 86 - "dependencies"
Cohesion: 0.12
Nodes (17): @aws-sdk/client-s3, bcrypt, express, joi, jsonwebtoken, node-cron, nodemailer, dependencies (+9 more)

### Community 87 - "routes/notification.js"
Cohesion: 0.16
Nodes (12): getNotifications(), getNotificationsCount(), markAllRead(), mongoose, NotificationModel, { parsePagination }, mongoose, NotificationSchema (+4 more)

### Community 92 - "controllers/card.js"
Cohesion: 0.21
Nodes (11): addCard(), deleteCard(), { dollarsToCents, getStripe }, getSavedCards(), setDefaultCard(), stripe, User, express (+3 more)

### Community 102 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, backfill:order-ids, backfill:product-ids, backfill:usernames, dev, graph, migrate:cloudinary:s3, migrate:order-statuses (+3 more)

### Community 107 - "s3MediaService.js"
Cohesion: 0.12
Nodes (14): { S3Client }, ALLOWED_FOLDERS, express, { getSignedUrl }, { PutObjectCommand }, router, s3Client, { v4: uuidv4 } (+6 more)

### Community 111 - "package.json"
Cohesion: 0.15
Nodes (12): cross-env, nodemon, author, description, devDependencies, cross-env, nodemon, keywords (+4 more)

### Community 113 - "aiGenerationService.js"
Cohesion: 0.10
Nodes (13): aiContentSchema, mongoose, aiGenerationSchema, mongoose, aiPromptSchema, mongoose, AIContent, AIGeneration (+5 more)

### Community 123 - "subscriptionPlan.js"
Cohesion: 0.25
Nodes (9): createPlan(), deletePlan(), fetchPlans(), SubscriptionPlan, updatePlan(), {
  createPlan,
  fetchPlans,
  updatePlan,
  deletePlan,
}, express, router (+1 more)

### Community 124 - "app.js"
Cohesion: 0.20
Nodes (9): app, cors, express, { handleBoostWebhook }, { handleStripeWebhook }, logger, presignedUrlRoutes, routes (+1 more)

### Community 125 - "controllers/campaignObjective.js"
Cohesion: 0.13
Nodes (17): CampaignObjective, createCampaignObjective(), {
  createCampaignObjectiveSchema,
  updateCampaignObjectiveSchema,
}, deleteCampaignObjective(), getCampaignObjectiveById(), getCampaignObjectives(), { parsePagination }, { schemaValidator } (+9 more)

### Community 152 - "test-ai-system.js"
Cohesion: 0.11
Nodes (16): AIContent, AIGeneration, aiGenerationService, AIUsage, CreditPricing, creditService, CreditTransaction, dotenv (+8 more)

### Community 157 - "models/fanSubscription.js"
Cohesion: 0.33
Nodes (3): FanSubscriptionModel, fanSubscriptionSchema, mongoose

### Community 184 - "create-internal-users.js"
Cohesion: 0.40
Nodes (5): bcrypt, bulkCreateInternalUsers(), generateUsername(), { getStripe }, UserModel

### Community 246 - "models/order.js"
Cohesion: 0.18
Nodes (8): MIGRATIONS, mongoose, Order, cardDetailsSchema, deliverySchema, mongoose, orderItemSchema, orderSchema

### Community 309 - "liveStreamHandlers.js"
Cohesion: 0.60
Nodes (5): emitViewerCount(), getViewerCount(), liveStreamHandlers(), removeViewer(), streamViewers

## Knowledge Gaps
- **779 isolated node(s):** `name`, `version`, `main`, `test`, `dev` (+774 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 879 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **77 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `schemaValidator()` connect `schemaValidator` to `engagementHelper.js`, `controllers/exclusiveContent.js`, `controllers/boost.js`, `controllers/auth.js`, `user.js`, `controllers/post.js`, `controllers/ai.js`, `campaignEngagement.js`, `controllers/deal.js`, `controllers/favourite.js`, `helper.js`, `controllers/follow.js`, `controllers/campaignCategory.js`, `models/auth.js`, `controllers/campaign.js`, `controllers/subscription.js`, `controllers/creatorSubscription.js`, `controllers/liveStream.js`, `controllers/liveStreamPayment.js`, `socialHelpers.js`, `validator.js`, `controllers/campaignObjective.js`?**
  _High betweenness centrality (0.079) - this node is a cross-community bridge._
- **Why does `getStripe()` connect `getStripe` to `controllers/campaign.js`, `controllers/boost.js`, `utils/stripe.js`, `controllers/auth.js`, `orderPayment.js`, `controllers/subscription.js`, `controllers/creatorSubscription.js`, `controllers/card.js`, `controllers/deal.js`, `schemaValidator`, `controllers/order.js`, `create-internal-users.js`, `controllers/liveStreamPayment.js`, `app.js`, `controllers/stripe.js`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Why does `verifyUser()` connect `middlewares/auth.js` to `controllers/exclusiveContent.js`, `controllers/boost.js`, `user.js`, `campaignEngagement.js`, `controllers/favourite.js`, `schemaValidator`, `parsePagination`, `controllers/follow.js`, `models/auth.js`, `controllers/campaign.js`, `routes/post.js`, `controllers/product.js`, `getStripe`, `controllers/cart.js`, `controllers/subscription.js`, `routes/activityLog.js`, `controllers/liveStream.js`, `routes/order.js`, `controllers/payout.js`, `middlewares/admin.js`, `routes/conversation.js`, `socialHelpers.js`, `routes/ai.js`, `routes/message.js`, `routes/notification.js`, `controllers/card.js`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **What connects `name`, `version`, `main` to the rest of the system?**
  _779 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `engagementHelper.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08143939393939394 - nodes in this community are weakly interconnected._
- **Should `controllers/exclusiveContent.js` be split into smaller, more focused modules?**
  _Cohesion score 0.0989247311827957 - nodes in this community are weakly interconnected._
- **Should `controllers/boost.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08266129032258064 - nodes in this community are weakly interconnected._