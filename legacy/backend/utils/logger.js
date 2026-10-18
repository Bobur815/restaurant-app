import winston from "winston";
import path from "path"

const logger = winston.createLogger({
    level:"info",
    format: winston.format.combine(
        winston.format.timestamp({format:'DD-MM-YYYY | HH:mm:ss'}),
        winston.format.printf(({timestamp, level, message}) => {
            return `${timestamp} | [${level.toUpperCase()}] : ${message}`
        })
    ),

    transports: [
        new winston.transports.Console(),
        new winston.transports.File({filename:path.join(process.cwd(), "utils","errors.log") })
    ],
});

export default logger