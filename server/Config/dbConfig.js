const mongoose = require("mongoose");

//CONNECTION LOGIC
mongoose.connect(process.env.CONN_STRING);

//CONNECTION STATE
const db = mongoose.connection;

db.on("connected",() => {
    console.log("DB Connected Successfull");
});

db.on("error",(error) => {
    console.log("DB Connection Failed ",error.message);
});

module.exports = db;