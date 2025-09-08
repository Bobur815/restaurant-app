import ResidualService from "../service/Residual.service.js"

class ResidualController {
    constructor () {}

    async getToCarryResidual(req,res,next){
        try {
            const residuals = await ResidualService.getToCarryResidual()
            res.json({ ok: true, data: residuals });
        } catch (error) {
            next(error)
        }
    }
}

export default new ResidualController()