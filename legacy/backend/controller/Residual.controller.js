import ResidualService from "../service/Residual.service.js"

class ResidualController {
    constructor () {}

    async getToCarryResidual(req,res,next){
        try {
            const residuals = await ResidualService.getResiduals()
            res.json({ ok: true, data: residuals });
        } catch (error) {
            next(error)
        }
    }

    async applyResidualsToSession(req,res,next){
        try {
            const { sessionId, residualIds } = req.body
            if(!sessionId || !residualIds?.length){
                return res.status(400).json({ ok: false, message: "sessionId and residualIds are required" })
            }
            const updatedResiduals = await ResidualService.applyResidualsToSession(sessionId, residualIds)
            res.json({ ok: true, data: updatedResiduals });
        } catch (error) {
            next(error)
        }
    }
}

export default new ResidualController()