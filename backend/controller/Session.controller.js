// src/controllers/Session.controller.js
import sessionService from "../service/Session.service.js";
import CustomError from "../utils/CustomError.js";
import { Validators } from "../utils/Joi.validation.js";

class SessionController {
    constructor() { }

    /** GET /sessions?status=open|closed */
    async getAll(req, res, next) {
        try {
            const filter = {};
            if (req.query.status) {
                filter.status = req.query.status;
            }
            
            const sessions = await sessionService.getAll(filter);
            
            res.status(200).json(sessions);
        } catch (error) {
            next(error);
        }
    }

    /** GET /sessions/:sessionId */
    async getOne(req, res, next) {
        try {
            const session = await sessionService.getSingle(req.params.sessionId);
            if (!session) {
                throw new CustomError("Session not found", 404, "NotFound");
            }
            res.status(200).json(session);
        } catch (error) {
            next(error);
        }
    }

    /** POST /sessions */
    async create(req, res, next) {
        try {
            const { error, value } = Validators.sessionValidator.validate(req.body);
            if (error) {
                throw new CustomError(
                    error.details[0].message,
                    400,
                    "ValidationError"
                );
            }
            const newSession = await sessionService.create(value);
            
            
            res.status(201).json({
                message: "✅ New session started",
                data: newSession
            });
        } catch (error) {
            next(error);
        }
    }

    /** PUT /sessions/:sessionId */
    async update(req, res, next) {
        try {
            const { error, value } = Validators.sessionValidator.validate(req.body);
            if (error) {
                throw new CustomError(
                    error.details[0].message,
                    400,
                    "ValidationError"
                );
            }
            const updated = await sessionService.update(
                req.params.sessionId,
                value
            );
            res.status(200).json({
                message: "✅ Session updated",
                data: updated
            });
        } catch (error) {
            next(error);
        }
    }

    async close(req, res, next) {
        try {
            const closed = await sessionService.close(req.params.sessionId, req.body || {});
            if (!closed) {
                return res.status(404).json({ message: "Session not found" });
            }
            res.status(200).json({
                message: "✅ Session closed",
                data: closed
            });
        } catch (error) {
            next(error);
        }
    }

    /** DELETE /sessions/:sessionId */
    async deleteSession(req, res, next) {
        try {
            const result = await sessionService.delete(req.params.sessionId);
            res.status(200).json({
                message: result
                    ? "✅ Session deleted"
                    : "⚠️ Session not found"
            });
        } catch (error) {
            next(error);
        }
    }
}

export default new SessionController();
