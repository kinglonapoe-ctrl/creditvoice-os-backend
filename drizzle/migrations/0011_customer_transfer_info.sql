ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS transfer_info text;
ALTER TABLE public.customers ADD CONSTRAINT customers_transfer_info_len CHECK (transfer_info IS NULL OR char_length(transfer_info) <= 300);
COMMENT ON COLUMN public.customers.transfer_info IS 'Optional notice spoken to this customer on the phone line before a transfer; customer must press 1 to continue.';