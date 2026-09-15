export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          actor_id: string | null
          actor_role: Database["public"]["Enums"]["app_role"] | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          event_type: string
          id: string
          ip_address: string | null
          metadata: Json
          tenant_id: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_role?: Database["public"]["Enums"]["app_role"] | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type: string
          id?: string
          ip_address?: string | null
          metadata?: Json
          tenant_id?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_role?: Database["public"]["Enums"]["app_role"] | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type?: string
          id?: string
          ip_address?: string | null
          metadata?: Json
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      call_auth_failures: {
        Row: {
          attempt: number
          created_at: string
          from_number: string | null
          id: string
          reason: string
          session_id: string | null
          stage: Database["public"]["Enums"]["call_auth_stage"]
          tenant_id: string | null
          to_number: string | null
        }
        Insert: {
          attempt?: number
          created_at?: string
          from_number?: string | null
          id?: string
          reason: string
          session_id?: string | null
          stage: Database["public"]["Enums"]["call_auth_stage"]
          tenant_id?: string | null
          to_number?: string | null
        }
        Update: {
          attempt?: number
          created_at?: string
          from_number?: string | null
          id?: string
          reason?: string
          session_id?: string | null
          stage?: Database["public"]["Enums"]["call_auth_stage"]
          tenant_id?: string | null
          to_number?: string | null
        }
        Relationships: []
      }
      call_session_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          payload: Json
          provider: string
          provider_event_id: string
          session_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
          provider?: string
          provider_event_id: string
          session_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          provider?: string
          provider_event_id?: string
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_session_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "call_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      call_sessions: {
        Row: {
          access_code_attempts: number
          account_id: string | null
          attempt_count: number
          authenticated_at: string | null
          authentication_stage: Database["public"]["Enums"]["call_auth_stage"]
          created_at: string
          customer_id: string | null
          ended_at: string | null
          failure_reason: string | null
          from_number: string
          id: string
          last_activity_at: string
          metadata: Json
          pin_attempts: number
          provider: string
          provider_call_id: string | null
          provider_event_id: string | null
          state: Database["public"]["Enums"]["call_session_state"]
          tenant_id: string | null
          to_number: string
          updated_at: string
        }
        Insert: {
          access_code_attempts?: number
          account_id?: string | null
          attempt_count?: number
          authenticated_at?: string | null
          authentication_stage?: Database["public"]["Enums"]["call_auth_stage"]
          created_at?: string
          customer_id?: string | null
          ended_at?: string | null
          failure_reason?: string | null
          from_number: string
          id?: string
          last_activity_at?: string
          metadata?: Json
          pin_attempts?: number
          provider?: string
          provider_call_id?: string | null
          provider_event_id?: string | null
          state?: Database["public"]["Enums"]["call_session_state"]
          tenant_id?: string | null
          to_number: string
          updated_at?: string
        }
        Update: {
          access_code_attempts?: number
          account_id?: string | null
          attempt_count?: number
          authenticated_at?: string | null
          authentication_stage?: Database["public"]["Enums"]["call_auth_stage"]
          created_at?: string
          customer_id?: string | null
          ended_at?: string | null
          failure_reason?: string | null
          from_number?: string
          id?: string
          last_activity_at?: string
          metadata?: Json
          pin_attempts?: number
          provider?: string
          provider_call_id?: string | null
          provider_event_id?: string | null
          state?: Database["public"]["Enums"]["call_session_state"]
          tenant_id?: string | null
          to_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_sessions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "customer_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_sessions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      currencies: {
        Row: {
          code: string
          created_at: string
          decimal_places: number
          is_active: boolean
          name: string
          symbol: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          decimal_places?: number
          is_active?: boolean
          name: string
          symbol: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          decimal_places?: number
          is_active?: boolean
          name?: string
          symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      customer_accounts: {
        Row: {
          account_number: string | null
          balance: number
          created_at: string
          credit_limit: number
          currency_code: string
          customer_id: string
          id: string
          status: Database["public"]["Enums"]["account_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_number?: string | null
          balance?: number
          created_at?: string
          credit_limit?: number
          currency_code: string
          customer_id: string
          id?: string
          status?: Database["public"]["Enums"]["account_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_number?: string | null
          balance?: number
          created_at?: string
          credit_limit?: number
          currency_code?: string
          customer_id?: string
          id?: string
          status?: Database["public"]["Enums"]["account_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_accounts_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "customer_accounts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_care_settings: {
        Row: {
          after_hours_mode: Database["public"]["Enums"]["routing_mode"]
          backup_number: string | null
          business_hours_end: string
          business_hours_start: string
          created_at: string
          enabled: boolean
          primary_number: string | null
          routing_mode: Database["public"]["Enums"]["routing_mode"]
          tenant_id: string
          timezone: string
          updated_at: string
          voicemail_enabled: boolean
        }
        Insert: {
          after_hours_mode?: Database["public"]["Enums"]["routing_mode"]
          backup_number?: string | null
          business_hours_end?: string
          business_hours_start?: string
          created_at?: string
          enabled?: boolean
          primary_number?: string | null
          routing_mode?: Database["public"]["Enums"]["routing_mode"]
          tenant_id: string
          timezone?: string
          updated_at?: string
          voicemail_enabled?: boolean
        }
        Update: {
          after_hours_mode?: Database["public"]["Enums"]["routing_mode"]
          backup_number?: string | null
          business_hours_end?: string
          business_hours_start?: string
          created_at?: string
          enabled?: boolean
          primary_number?: string | null
          routing_mode?: Database["public"]["Enums"]["routing_mode"]
          tenant_id?: string
          timezone?: string
          updated_at?: string
          voicemail_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "customer_care_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_pins: {
        Row: {
          customer_id: string
          failed_attempts: number
          locked_until: string | null
          pin_hash: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          customer_id: string
          failed_attempts?: number
          locked_until?: string | null
          pin_hash: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          customer_id?: string
          failed_attempts?: number
          locked_until?: string | null
          pin_hash?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_pins_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string
          customer_reference: string | null
          email: string | null
          full_name: string
          id: string
          phone: string
          status: Database["public"]["Enums"]["customer_status"]
          tenant_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          customer_reference?: string | null
          email?: string | null
          full_name: string
          id?: string
          phone: string
          status?: Database["public"]["Enums"]["customer_status"]
          tenant_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          customer_reference?: string | null
          email?: string | null
          full_name?: string
          id?: string
          phone?: string
          status?: Database["public"]["Enums"]["customer_status"]
          tenant_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_idempotency: {
        Row: {
          created_at: string
          idempotency_key: string
          operation: string
          result_id: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          idempotency_key: string
          operation: string
          result_id?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          idempotency_key?: string
          operation?: string
          result_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_idempotency_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ivr_settings: {
        Row: {
          balance_enquiry_enabled: boolean
          created_at: string
          language: string
          max_pin_attempts: number
          session_timeout_seconds: number
          tenant_id: string
          transfers_enabled: boolean
          updated_at: string
          welcome_message: string
        }
        Insert: {
          balance_enquiry_enabled?: boolean
          created_at?: string
          language?: string
          max_pin_attempts?: number
          session_timeout_seconds?: number
          tenant_id: string
          transfers_enabled?: boolean
          updated_at?: string
          welcome_message?: string
        }
        Update: {
          balance_enquiry_enabled?: boolean
          created_at?: string
          language?: string
          max_pin_attempts?: number
          session_timeout_seconds?: number
          tenant_id?: string
          transfers_enabled?: boolean
          updated_at?: string
          welcome_message?: string
        }
        Relationships: [
          {
            foreignKeyName: "ivr_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_accounts: {
        Row: {
          account_id: string | null
          balance: number
          created_at: string
          currency_code: string
          id: string
          kind: string
          tenant_id: string
        }
        Insert: {
          account_id?: string | null
          balance?: number
          created_at?: string
          currency_code: string
          id?: string
          kind?: string
          tenant_id: string
        }
        Update: {
          account_id?: string | null
          balance?: number
          created_at?: string
          currency_code?: string
          id?: string
          kind?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "customer_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_accounts_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "ledger_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_entries: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          currency_code: string
          direction: Database["public"]["Enums"]["ledger_direction"]
          id: string
          ledger_account_id: string
          tenant_id: string
          transaction_id: string
        }
        Insert: {
          amount: number
          balance_after: number
          created_at?: string
          currency_code: string
          direction: Database["public"]["Enums"]["ledger_direction"]
          id?: string
          ledger_account_id: string
          tenant_id: string
          transaction_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          currency_code?: string
          direction?: Database["public"]["Enums"]["ledger_direction"]
          id?: string
          ledger_account_id?: string
          tenant_id?: string
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "ledger_entries_ledger_account_id_fkey"
            columns: ["ledger_account_id"]
            isOneToOne: false
            referencedRelation: "ledger_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_numbers: {
        Row: {
          assigned_at: string | null
          country: string
          country_calling_code: string
          created_at: string
          id: string
          is_primary: boolean
          phone_number: string
          provider: string
          provider_number_id: string | null
          sms_capable: boolean
          status: Database["public"]["Enums"]["phone_number_status"]
          tenant_id: string | null
          updated_at: string
          voice_capable: boolean
        }
        Insert: {
          assigned_at?: string | null
          country: string
          country_calling_code: string
          created_at?: string
          id?: string
          is_primary?: boolean
          phone_number: string
          provider?: string
          provider_number_id?: string | null
          sms_capable?: boolean
          status?: Database["public"]["Enums"]["phone_number_status"]
          tenant_id?: string | null
          updated_at?: string
          voice_capable?: boolean
        }
        Update: {
          assigned_at?: string | null
          country?: string
          country_calling_code?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          phone_number?: string
          provider?: string
          provider_number_id?: string | null
          sms_capable?: boolean
          status?: Database["public"]["Enums"]["phone_number_status"]
          tenant_id?: string | null
          updated_at?: string
          voice_capable?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "phone_numbers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      tenant_access_codes: {
        Row: {
          code_hash: string
          created_at: string
          failed_attempts: number
          id: string
          is_active: boolean
          locked_until: string | null
          retired_at: string | null
          tenant_id: string
        }
        Insert: {
          code_hash: string
          created_at?: string
          failed_attempts?: number
          id?: string
          is_active?: boolean
          locked_until?: string | null
          retired_at?: string | null
          tenant_id: string
        }
        Update: {
          code_hash?: string
          created_at?: string
          failed_attempts?: number
          id?: string
          is_active?: boolean
          locked_until?: string | null
          retired_at?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_access_codes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_account_sequences: {
        Row: {
          next_number: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          next_number?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          next_number?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_account_sequences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_applications: {
        Row: {
          address: string | null
          admin_email: string
          admin_full_name: string
          admin_phone: string
          business_type: string | null
          country: string
          created_at: string
          description: string | null
          id: string
          legal_name: string
          organization_name: string
          requested_currency: string
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["application_status"]
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          admin_email: string
          admin_full_name: string
          admin_phone: string
          business_type?: string | null
          country: string
          created_at?: string
          description?: string | null
          id?: string
          legal_name: string
          organization_name: string
          requested_currency: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          admin_email?: string
          admin_full_name?: string
          admin_phone?: string
          business_type?: string | null
          country?: string
          created_at?: string
          description?: string | null
          id?: string
          legal_name?: string
          organization_name?: string
          requested_currency?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_applications_requested_currency_fkey"
            columns: ["requested_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "tenant_applications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          access_code_last_changed_at: string | null
          access_code_status: string
          address: string | null
          business_type: string | null
          country: string
          created_at: string
          currency_approved: boolean
          currency_code: string | null
          description: string | null
          id: string
          legal_name: string
          name: string
          status: Database["public"]["Enums"]["tenant_status"]
          updated_at: string
        }
        Insert: {
          access_code_last_changed_at?: string | null
          access_code_status?: string
          address?: string | null
          business_type?: string | null
          country: string
          created_at?: string
          currency_approved?: boolean
          currency_code?: string | null
          description?: string | null
          id?: string
          legal_name: string
          name: string
          status?: Database["public"]["Enums"]["tenant_status"]
          updated_at?: string
        }
        Update: {
          access_code_last_changed_at?: string | null
          access_code_status?: string
          address?: string | null
          business_type?: string | null
          country?: string
          created_at?: string
          currency_approved?: boolean
          currency_code?: string | null
          description?: string | null
          id?: string
          legal_name?: string
          name?: string
          status?: Database["public"]["Enums"]["tenant_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenants_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      transactions: {
        Row: {
          account_id: string | null
          amount: number
          counterparty_account_id: string | null
          created_at: string
          created_by: string | null
          currency_code: string
          description: string | null
          id: string
          idempotency_key: string | null
          reference: string
          reversal_of_transaction_id: string | null
          status: Database["public"]["Enums"]["transaction_status"]
          tenant_id: string
          type: Database["public"]["Enums"]["transaction_type"]
        }
        Insert: {
          account_id?: string | null
          amount: number
          counterparty_account_id?: string | null
          created_at?: string
          created_by?: string | null
          currency_code: string
          description?: string | null
          id?: string
          idempotency_key?: string | null
          reference: string
          reversal_of_transaction_id?: string | null
          status?: Database["public"]["Enums"]["transaction_status"]
          tenant_id: string
          type: Database["public"]["Enums"]["transaction_type"]
        }
        Update: {
          account_id?: string | null
          amount?: number
          counterparty_account_id?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string
          description?: string | null
          id?: string
          idempotency_key?: string | null
          reference?: string
          reversal_of_transaction_id?: string | null
          status?: Database["public"]["Enums"]["transaction_status"]
          tenant_id?: string
          type?: Database["public"]["Enums"]["transaction_type"]
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "customer_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_counterparty_account_id_fkey"
            columns: ["counterparty_account_id"]
            isOneToOne: false
            referencedRelation: "customer_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "transactions_reversal_of_transaction_id_fkey"
            columns: ["reversal_of_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      transfers: {
        Row: {
          amount: number
          completed_at: string | null
          currency_code: string
          failure_reason: string | null
          id: string
          idempotency_key: string | null
          initiated_at: string
          initiated_by: string | null
          recipient_account_id: string
          reference: string
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          sender_account_id: string
          status: Database["public"]["Enums"]["transfer_status"]
          tenant_id: string
          transaction_id: string | null
        }
        Insert: {
          amount: number
          completed_at?: string | null
          currency_code: string
          failure_reason?: string | null
          id?: string
          idempotency_key?: string | null
          initiated_at?: string
          initiated_by?: string | null
          recipient_account_id: string
          reference: string
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          sender_account_id: string
          status?: Database["public"]["Enums"]["transfer_status"]
          tenant_id: string
          transaction_id?: string | null
        }
        Update: {
          amount?: number
          completed_at?: string | null
          currency_code?: string
          failure_reason?: string | null
          id?: string
          idempotency_key?: string | null
          initiated_at?: string
          initiated_by?: string | null
          recipient_account_id?: string
          reference?: string
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          sender_account_id?: string
          status?: Database["public"]["Enums"]["transfer_status"]
          tenant_id?: string
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transfers_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "transfers_recipient_account_id_fkey"
            columns: ["recipient_account_id"]
            isOneToOne: false
            referencedRelation: "customer_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfers_sender_account_id_fkey"
            columns: ["sender_account_id"]
            isOneToOne: false
            referencedRelation: "customer_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfers_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      allocate_account_number: { Args: { _tenant_id: string }; Returns: string }
      assert_tenant_operational: {
        Args: { _tenant_id: string }
        Returns: undefined
      }
      claim_idempotency: {
        Args: { _key: string; _operation: string; _tenant_id: string }
        Returns: string
      }
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      current_user_tenant_id: { Args: never; Returns: string }
      cv_apply_transition: {
        Args: {
          _failure_reason?: string
          _session_id: string
          _stage?: Database["public"]["Enums"]["call_auth_stage"]
          _to: Database["public"]["Enums"]["call_session_state"]
        }
        Returns: {
          access_code_attempts: number
          account_id: string | null
          attempt_count: number
          authenticated_at: string | null
          authentication_stage: Database["public"]["Enums"]["call_auth_stage"]
          created_at: string
          customer_id: string | null
          ended_at: string | null
          failure_reason: string | null
          from_number: string
          id: string
          last_activity_at: string
          metadata: Json
          pin_attempts: number
          provider: string
          provider_call_id: string | null
          provider_event_id: string | null
          state: Database["public"]["Enums"]["call_session_state"]
          tenant_id: string | null
          to_number: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "call_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cv_audit: {
        Args: {
          _entity_id: string
          _event: string
          _metadata: Json
          _tenant_id: string
        }
        Returns: undefined
      }
      cv_authorize_action: {
        Args: {
          _action: Database["public"]["Enums"]["call_action"]
          _session_id: string
          _target_account_id?: string
        }
        Returns: Json
      }
      cv_begin_access_code_attempt: {
        Args: { _session_id: string }
        Returns: Json
      }
      cv_begin_pin_attempt: { Args: { _session_id: string }; Returns: Json }
      cv_claim_session_event: {
        Args: {
          _event_type: string
          _payload?: Json
          _provider: string
          _provider_event_id: string
          _session_id: string
        }
        Returns: boolean
      }
      cv_create_call_session: {
        Args: {
          _from_number: string
          _provider?: string
          _provider_call_id?: string
          _provider_event_id?: string
          _to_number: string
        }
        Returns: string
      }
      cv_end_call_session: {
        Args: { _reason?: string; _session_id: string }
        Returns: Json
      }
      cv_expire_call_sessions: { Args: never; Returns: number }
      cv_finish_access_code_attempt: {
        Args: { _code_id: string; _session_id: string; _verified: boolean }
        Returns: Json
      }
      cv_finish_pin_attempt: {
        Args: { _session_id: string; _verified: boolean }
        Returns: Json
      }
      cv_get_authenticated_session: {
        Args: { _session_id: string }
        Returns: Json
      }
      cv_identify_account: {
        Args: { _account_number: string; _session_id: string }
        Returns: Json
      }
      cv_load_live_session: {
        Args: { _session_id: string }
        Returns: {
          access_code_attempts: number
          account_id: string | null
          attempt_count: number
          authenticated_at: string | null
          authentication_stage: Database["public"]["Enums"]["call_auth_stage"]
          created_at: string
          customer_id: string | null
          ended_at: string | null
          failure_reason: string | null
          from_number: string
          id: string
          last_activity_at: string
          metadata: Json
          pin_attempts: number
          provider: string
          provider_call_id: string | null
          provider_event_id: string | null
          state: Database["public"]["Enums"]["call_session_state"]
          tenant_id: string | null
          to_number: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "call_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cv_record_failure: {
        Args: {
          _attempt: number
          _reason: string
          _session: Database["public"]["Tables"]["call_sessions"]["Row"]
          _stage: Database["public"]["Enums"]["call_auth_stage"]
        }
        Returns: undefined
      }
      cv_resolve_tenant: { Args: { _session_id: string }; Returns: Json }
      cv_setting_int: {
        Args: { _default: number; _key: string }
        Returns: number
      }
      cv_test_admin: {
        Args: { _action: string; _id: string }
        Returns: undefined
      }
      cv_test_cleanup: { Args: { _tenant_id: string }; Returns: undefined }
      cv_test_setup: { Args: never; Returns: Json }
      cv_test_voice_cleanup: {
        Args: { _tenant_ids: string[] }
        Returns: undefined
      }
      cv_test_voice_setup: {
        Args: { _access_hash: string; _pin_hash: string }
        Returns: Json
      }
      cv_transition_allowed: {
        Args: {
          _from: Database["public"]["Enums"]["call_session_state"]
          _to: Database["public"]["Enums"]["call_session_state"]
        }
        Returns: boolean
      }
      ensure_ledger_account: { Args: { _account_id: string }; Returns: string }
      execute_transfer: {
        Args: {
          _amount: number
          _description?: string
          _idempotency_key?: string
          _recipient_account_id: string
          _sender_account_id: string
        }
        Returns: string
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_super_admin: { Args: never; Returns: boolean }
      post_credit: {
        Args: {
          _account_id: string
          _amount: number
          _description?: string
          _idempotency_key?: string
          _type: Database["public"]["Enums"]["transaction_type"]
        }
        Returns: string
      }
      reconcile_account_balances: {
        Args: { _tenant_id: string }
        Returns: {
          account_id: string
          account_number: string
          cached_balance: number
          drift: number
          ledger_balance: number
        }[]
      }
      register_credential_failure: {
        Args: { _id: string; _kind: string }
        Returns: number
      }
      reverse_transfer: {
        Args: { _reason?: string; _transfer_id: string }
        Returns: string
      }
    }
    Enums: {
      account_status: "ACTIVE" | "SUSPENDED" | "CLOSED"
      app_role: "SUPER_ADMIN" | "TENANT_ADMIN" | "CUSTOMER"
      application_status: "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED"
      call_action:
        | "CHECK_BALANCE"
        | "VIEW_ACCOUNT"
        | "TRANSFER_CREDIT"
        | "END_SESSION"
      call_auth_stage:
        | "TENANT_RESOLUTION"
        | "ACCESS_CODE"
        | "ACCOUNT_IDENTIFICATION"
        | "PIN"
        | "AUTHENTICATED"
        | "CLOSED"
      call_session_state:
        | "NEW"
        | "TENANT_RESOLVED"
        | "ACCESS_CODE_VERIFIED"
        | "ACCOUNT_IDENTIFIED"
        | "PIN_VERIFIED"
        | "AUTHENTICATED"
        | "PROCESSING"
        | "COMPLETED"
        | "FAILED"
        | "LOCKED"
        | "EXPIRED"
        | "ENDED"
      customer_status: "PENDING" | "ACTIVE" | "SUSPENDED" | "CLOSED"
      ledger_direction: "DEBIT" | "CREDIT"
      phone_number_status:
        | "AVAILABLE"
        | "RESERVED"
        | "ASSIGNED"
        | "ACTIVE"
        | "SUSPENDED"
        | "RELEASED"
      routing_mode:
        | "LIVE_AGENT"
        | "SEQUENTIAL"
        | "SIMULTANEOUS"
        | "QUEUE"
        | "VOICEMAIL"
      tenant_status: "CONFIGURATION" | "ACTIVE" | "SUSPENDED" | "CLOSED"
      transaction_status: "PENDING" | "COMPLETED" | "FAILED" | "REVERSED"
      transaction_type:
        | "INITIAL_CREDIT"
        | "CREDIT_ADJUSTMENT"
        | "TRANSFER"
        | "TRANSFER_REVERSAL"
        | "CREDIT_DEBIT"
        | "CREDIT_REPAYMENT"
      transfer_status:
        | "INITIATED"
        | "VALIDATING"
        | "AWAITING_CONFIRMATION"
        | "PROCESSING"
        | "COMPLETED"
        | "FAILED"
        | "REVERSED"
        | "CANCELLED"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_status: ["ACTIVE", "SUSPENDED", "CLOSED"],
      app_role: ["SUPER_ADMIN", "TENANT_ADMIN", "CUSTOMER"],
      application_status: ["PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED"],
      call_action: [
        "CHECK_BALANCE",
        "VIEW_ACCOUNT",
        "TRANSFER_CREDIT",
        "END_SESSION",
      ],
      call_auth_stage: [
        "TENANT_RESOLUTION",
        "ACCESS_CODE",
        "ACCOUNT_IDENTIFICATION",
        "PIN",
        "AUTHENTICATED",
        "CLOSED",
      ],
      call_session_state: [
        "NEW",
        "TENANT_RESOLVED",
        "ACCESS_CODE_VERIFIED",
        "ACCOUNT_IDENTIFIED",
        "PIN_VERIFIED",
        "AUTHENTICATED",
        "PROCESSING",
        "COMPLETED",
        "FAILED",
        "LOCKED",
        "EXPIRED",
        "ENDED",
      ],
      customer_status: ["PENDING", "ACTIVE", "SUSPENDED", "CLOSED"],
      ledger_direction: ["DEBIT", "CREDIT"],
      phone_number_status: [
        "AVAILABLE",
        "RESERVED",
        "ASSIGNED",
        "ACTIVE",
        "SUSPENDED",
        "RELEASED",
      ],
      routing_mode: [
        "LIVE_AGENT",
        "SEQUENTIAL",
        "SIMULTANEOUS",
        "QUEUE",
        "VOICEMAIL",
      ],
      tenant_status: ["CONFIGURATION", "ACTIVE", "SUSPENDED", "CLOSED"],
      transaction_status: ["PENDING", "COMPLETED", "FAILED", "REVERSED"],
      transaction_type: [
        "INITIAL_CREDIT",
        "CREDIT_ADJUSTMENT",
        "TRANSFER",
        "TRANSFER_REVERSAL",
        "CREDIT_DEBIT",
        "CREDIT_REPAYMENT",
      ],
      transfer_status: [
        "INITIATED",
        "VALIDATING",
        "AWAITING_CONFIRMATION",
        "PROCESSING",
        "COMPLETED",
        "FAILED",
        "REVERSED",
        "CANCELLED",
      ],
    },
  },
} as const
