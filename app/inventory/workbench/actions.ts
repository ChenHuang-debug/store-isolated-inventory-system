"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireCurrentStore, can } from "@/lib/stores/current-store";

export type OperationState={error?:string;success?:string;batchId?:string};
const base=z.object({idempotencyKey:z.string().min(8),businessDate:z.string().date(),note:z.string().max(1000)});
function parseJson(formData:FormData){try{return JSON.parse(String(formData.get("itemsJson")??""));}catch{return null;}}
function resultError(error:unknown){const m=(error as Error).message;if(m.includes("permission_denied"))return"当前账号没有该操作权限。";if(m.includes("discrepancy_reason_required"))return"存在数量差异，必须选择差异原因。";if(m.includes("insufficient_inventory"))return"库存不足，整批出库未入账。";if(m.includes("idempotency_conflict"))return"请求编号冲突，请刷新后重试。";if(m.includes("adjustment_no_change"))return"纠错目标与当前库存相同。";return"操作失败，整批数据均未入账。";}

export async function receiptAction(_prev:OperationState,formData:FormData):Promise<OperationState>{
 const {session,store}=await requireCurrentStore();if(!can(store,"confirm_receipt"))return{error:"当前账号没有确认入库权限。"};
 const mode=z.enum(["confirm","cancel"]).safeParse(formData.get("mode"));const common=base.safeParse({idempotencyKey:formData.get("idempotencyKey"),businessDate:formData.get("businessDate"),note:formData.get("note")??""});const raw=parseJson(formData);
 if(!mode.success||!common.success||!Array.isArray(raw)||raw.length<1)return{error:"请选择待入库行并完整填写。"};
 const confirmSchema=z.array(z.object({pendingReceiptId:z.string().uuid(),cartons:z.number().int().nonnegative(),loose:z.number().int().nonnegative(),reasonCode:z.string().max(63),note:z.string().max(500)}));
 const parsed=confirmSchema.safeParse(raw);if(!parsed.success)return{error:parsed.error.issues[0].message};
 const items=mode.data==="cancel"?parsed.data.map(x=>({pendingReceiptId:x.pendingReceiptId,reasonCode:x.reasonCode,note:x.note})):parsed.data;
 try{const fn=mode.data==="cancel"?"cancel_pending_receipts":"confirm_pending_receipts";const r=await db.query<{batch_id:string;replayed:boolean}>(`select * from public.${fn}($1,$2,$3,$4,$5,$6)`,[session.tokenHash,store.id,common.data.idempotencyKey,common.data.businessDate,common.data.note,JSON.stringify(items)]);revalidatePath("/inventory/workbench");revalidatePath("/operations");return{success:mode.data==="cancel"?"剩余待入已取消。":"实际入库已确认。",batchId:r.rows[0].batch_id};}catch(e){return{error:resultError(e)}}
}

export async function outboundAction(_prev:OperationState,formData:FormData):Promise<OperationState>{
 const {session,store}=await requireCurrentStore();if(!can(store,"ship_inventory"))return{error:"当前账号没有出库权限。"};const common=base.safeParse({idempotencyKey:formData.get("idempotencyKey"),businessDate:formData.get("businessDate"),note:formData.get("note")??""});const items=z.array(z.object({productId:z.string().uuid(),quantity:z.number().int().positive(),note:z.string().max(500)})).min(1).safeParse(parseJson(formData));if(!common.success||!items.success)return{error:"请完整填写出库商品和正整数数量。"};
 try{const r=await db.query<{batch_id:string}>("select * from public.post_outbound($1,$2,$3,$4,$5,$6)",[session.tokenHash,store.id,common.data.idempotencyKey,common.data.businessDate,common.data.note,JSON.stringify(items.data)]);revalidatePath("/inventory/workbench");revalidatePath("/operations");return{success:"出库已确认。",batchId:r.rows[0].batch_id};}catch(e){return{error:resultError(e)}}
}

export async function adjustmentAction(_prev:OperationState,formData:FormData):Promise<OperationState>{
 const {session,store}=await requireCurrentStore();if(!can(store,"adjust_inventory"))return{error:"当前账号没有库存纠错权限。"};const common=base.safeParse({idempotencyKey:formData.get("idempotencyKey"),businessDate:formData.get("businessDate"),note:formData.get("note")??""});const items=z.array(z.object({productId:z.string().uuid(),targetQty:z.number().int().nonnegative(),reasonCode:z.string().min(1),note:z.string().min(1).max(500)})).min(1).safeParse(parseJson(formData));if(!common.success||!items.success)return{error:"纠错必须填写目标库存、具体原因和备注。"};
 try{const r=await db.query<{batch_id:string}>("select * from public.adjust_inventory($1,$2,$3,$4,$5,$6)",[session.tokenHash,store.id,common.data.idempotencyKey,common.data.businessDate,common.data.note,JSON.stringify(items.data)]);revalidatePath("/inventory/workbench");revalidatePath("/operations");return{success:"库存纠错已入账。",batchId:r.rows[0].batch_id};}catch(e){return{error:resultError(e)}}
}
