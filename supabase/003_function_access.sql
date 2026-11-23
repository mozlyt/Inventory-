-- Signed-out visitors cannot call the helper functions; nobody can call trigger functions directly.
REVOKE EXECUTE ON FUNCTION public.audit_row() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.customer_payment_check() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.customer_payment_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_owner() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_seller_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_seller_id() TO authenticated;
