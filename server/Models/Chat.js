const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({

    role : {
        type : String,
        enum : ["user","assistant"],
        required : true
    },
    content : {
        type : String,
        required : true
    }

},{ timestamps : true });

const chatSchema = new mongoose.Schema({
    title : {
        type : String,
        default : "New Chat",
        trim : true,
        maxLength : 100
    },
    messages : {
        type : [messageSchema],
        default : []
    }
});

module.exports = mongoose.Schema("Chat",chatSchema);