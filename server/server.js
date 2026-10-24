const path = require("path");
const dotenv = require("dotenv");

dotenv.config({
    path : path.join(__dirname,".env")
});

const dbConfig = require("./Config/dbConfig");

const server = require("./app");

const PORT = Number(process.env.PORT) || 8000;

server.listen(PORT,() => {
    console.log("Server is running on PORT "+PORT);
})