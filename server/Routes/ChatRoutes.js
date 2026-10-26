const router = require("express").Router();
const { createChat, getChats, getChatById, deleteChat, sendMessage } = require("../Controllers/ChatController");

router.post("/createChat",createChat);
router.post("/getChat",getChats);
router.post("/getChatId/:id",getChatById);
router.post("/deleteChat/:id",deleteChat);
router.post("/:id/sendMessage",sendMessage);

module.exports = router;