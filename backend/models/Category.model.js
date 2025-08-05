import { model, Schema } from "mongoose";

const categorySchema = new Schema({
    name: {type: String, unique: true, trim: true, required:true}
})

export default model('Category', categorySchema)