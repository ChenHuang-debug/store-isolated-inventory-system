revoke all on function public.set_demo_initial_temporary_carton_spec() from public;

comment on function public.set_demo_initial_temporary_carton_spec() is
  '受控 STORE_A 期初导入使用临时 60；仅由 products 触发器执行，public 无直接调用权限';
