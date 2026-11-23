-- Added after the data copy so copying did not create audit rows.
CREATE TRIGGER customer_payment_check BEFORE INSERT ON public.customer_payments FOR EACH ROW EXECUTE FUNCTION public.customer_payment_check();
CREATE TRIGGER customer_payment_guard BEFORE DELETE OR UPDATE ON public.customer_payments FOR EACH ROW EXECUTE FUNCTION public.customer_payment_guard();
CREATE TRIGGER audit_customer_payments AFTER INSERT OR DELETE OR UPDATE ON public.customer_payments FOR EACH ROW EXECUTE FUNCTION public.audit_row();
CREATE TRIGGER audit_customers AFTER INSERT OR DELETE OR UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.audit_row();
CREATE TRIGGER audit_sales AFTER INSERT OR DELETE OR UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION public.audit_row();
