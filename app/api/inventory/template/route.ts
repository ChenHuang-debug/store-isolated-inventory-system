import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession, resolveCurrentStore, withSessionContext } from "@/lib/auth/session";
import { buildOperationTemplate, templateFilename } from "@/lib/excel/template";

const schema=z.object({business:z.enum(["arrival","outbound"]),productIds:z.array(z.string().uuid()).min(1).max(500)});
export async function GET(request:NextRequest){
 const session=await getCurrentSession();if(!session)return NextResponse.json({error:"请先登录"},{status:401});
 const store=resolveCurrentStore(session,request.cookies.get("inventory_demo_current_store")?.value);if(!store)return NextResponse.json({error:"没有可用店铺"},{status:403});
 const parsed=schema.safeParse({business:request.nextUrl.searchParams.get("business"),productIds:request.nextUrl.searchParams.getAll("productId")});if(!parsed.success)return NextResponse.json({error:"请选择至少一个商品SKU"},{status:400});
 const permission=parsed.data.business==="arrival"?"record_arrival":"ship_inventory";if(!store.permissions.includes(permission))return NextResponse.json({error:"没有模板下载权限"},{status:403});
 const products=await withSessionContext(session,async c=>c.query<{id:string;sku:string;name_zh:string;units_per_carton:number|null;carton_spec_status:string}>("select id,sku,name_zh,units_per_carton,carton_spec_status from public.products where store_id=$1 and is_active and id=any($2::uuid[]) order by sku",[store.id,parsed.data.productIds]));
 if(products.rowCount!==new Set(parsed.data.productIds).size)return NextResponse.json({error:"包含无效或跨店铺商品"},{status:400});
 if(parsed.data.business==="arrival"&&products.rows.some(r=>r.carton_spec_status!=="confirmed"||!r.units_per_carton))return NextResponse.json({error:"到仓模板只能包含已确认箱规的商品"},{status:400});
 const bytes=await buildOperationTemplate({business:parsed.data.business,storeId:store.id,storeCode:store.code,products:products.rows.map(r=>({sku:r.sku,name:r.name_zh,unitsPerCarton:r.units_per_carton}))});const filename=templateFilename(store.code,parsed.data.business);
 return new NextResponse(new Uint8Array(bytes),{headers:{"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}
