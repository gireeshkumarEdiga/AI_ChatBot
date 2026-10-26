const OpenAI = require("openai");
const Chat = require("../Models/Chat");
const { default: mongoose } = require("mongoose");

const openAI = new OpenAI({
    apiKey : process.env.OPENAI_API_KEY,
});

const MAX_MESSAGE_LENGTH = 10000;
const MAX_CONTEXT_MESSAGES = 20;

const createChat = async (req, res, next) => {

    try{

        const chat = await Chat.create({
            title : "New Chat",
            messages : []
        });

        res.status(201).send({
            Message : "Chat Created",
            Success : true,
            Data : chat
        });

    }catch(error){

        next(error);

    }

}

const getChats = async (req,res,next) => {

    try{

        const chats = new Chat.find().sort({ updatedAt : -1 }).lean();

        const Data = chats.map((x,i) => ({
            _id : x._id,
            title : x.title,
            createdAt : x.createdAt,
            updatedAt : x.updatedAt,
            messageCount : x.messages.length,
            lastMessage : x.messages.length > 0 
                        ? x.messages[x.messages.length-1].content.slice(0,100)                            
                        : "",
        }));

        res.status(200).send({
            Message : "",
            Success : true,
            Data : Data
        })

    }catch(error){
        next(error)
    }

}

const getChatById = async (req,res,next) => {

    try{

        if(!mongoose.isValidObjectId(req.params.id)){
            return res.status(400).send({
                Success : false,
                Message : "Invalid chat ID"
            });
        }

        const chat = await Chat.findById(req.params.id);

        if(!chat){
            return res.status(404).send({
                Message : "Chat not found",
                Success : false      
            });
        }

        res.status(200).send({
            Message : "Chat by Id",
            Success : true
        })

    }catch(error){
        next(error);
    }

}

const deleteChat = async (req,res,next) => {

    try{

        if(!mongoose.isValidObjectId(req.params.id)){
            res.status(400).send({
                Message : "Invalid chat ID",
                Success : false
            });
        }

        const chat = await Chat.findByIdAndDelete(req.params.id);

        if(!chat){
            res.status(404).send({
                Message : "Chat not found",
                Success : false
            });
        }

        res.status(200).send({
            Message : "Chat Deleted Successfully",
            Success : true
        });

    }catch(error){
        next(error);
    }

}

const sendMessage = async (req,res,next) => {

    let responseStarted = false;
    let assistantText = "";

    try{

        const { message } = req.body;
        const { id } = req.params;

        if(!mongoose.isValidObjectId(id)){

            return res.status(400).send({
                Message : "Invalid Chat Id",
                Success : false
            });

        }

        if(typeof message !== "String" || !message.trim() || message.length > MAX_MESSAGE_LENGTH ){

            return res.status(400).send({
                Message : `Message must contain 1-${MAX_MESSAGE_LENGTH} Characters`,
            })

        }

        const chat = await Chat.findById(id);

        if(!chat){
            return res.status(404).send({
                Message : "Chat not found",
                Success : false
            })
        }

        const userMessage = message.trim();

        chat.message.push({
            content : userMessage,
            role : "user"
        });

        if(chat.title == "New Chat"){
            chat.title = userMessage.length > 45 
                        ? `${userMessage.slice(0,45)}...` 
                        : userMessage;
        }

        await chat.save();

        const context = chat.message
                        .slice(MAX_CONTEXT_MESSAGES)
                        .map((x) => ({
                            role : x.role,
                            content : x.content
                        }));

        const  stream = await openAI.chat.completions.create({
            model : "gpt-4.1-mini",
            message : [
                {
                    role : "system",
                    content : "You are a helpful AI assistant. Answer clearly and accurately. Use previous messages for context. if you do not know an answer, say so."
                },
                ...context
            ],
            stream : true
        });

        res.status(200);
        res.setHeader("Content-Type","text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control","no-cache, no-transform");
        res.setHeader("Connections","keep-alive");
        res.setHeader("X-Accel-Buffering","no");

        if(typeof res.flushHeaders === "function"){
            res.flushHeaders();
        }

        responseStarted = true;

        for await(const chunk of stream){

            const token = chunk.choices[0]?.delta?.content || "";

            if(token){

                assistantText += token;

                res.write(
                    `data : ${JSON.stringify({ type : "token", content : token })}\n\n`
                )

            }

        }

        if(assistantText.trim()){

            await Chat.updatedOne(
                { _id : id },
                {
                    $push : {
                        message : {
                            role : "assistant",
                            content : assistantText,
                        }
                    }
                }
            )

        }

        res.write(`data : ${JSON.stringify({ type : "done" })}\n\n`);
        res.end();

    }catch(error){

        console.error("Chat generation error : ",error.message);

        if(!responseStarted){
            return next(error);
        }

        if(assistantText.trim()){

            try{

            }catch(error){
                console.error("Unable to save partial response : ",error.message);   
            }

        }

        if(!res.writeableEnded){

            res.write(
                `data : ${JSON.stringify({
                    type : "error",
                    message : "Unable to finish the AI response. Please try again."   
                })}\n\n`
            );

            res.end();

        }

    }

}

module.exports = {
    createChat,
    getChats,
    getChatById,
    deleteChat,
    sendMessage
}