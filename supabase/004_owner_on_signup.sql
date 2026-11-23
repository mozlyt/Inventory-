-- When the owner's account (mozlyt0@gmail.com) is created in Supabase Auth, it becomes the app owner automatically.
CREATE OR REPLACE FUNCTION public.claim_owner() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$ BEGIN
  IF lower(NEW.email) = 'mozlyt0@gmail.com' THEN
    INSERT INTO public.app_owner (user_id, email) VALUES (NEW.id::text, NEW.email) ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $f$;
REVOKE EXECUTE ON FUNCTION public.claim_owner() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER on_auth_user_created_claim_owner AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.claim_owner();
