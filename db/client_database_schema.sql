--
-- PostgreSQL database dump for playwright_client schema
-- Source: PostgreSQL 18.2, Target: PostgreSQL 16.8 (OCI Managed)
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';

CREATE FUNCTION public._set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

SET default_tablespace = '';
SET default_table_access_method = heap;

CREATE TABLE public.exec_script_processes (
    script_id uuid NOT NULL,
    process_id uuid NOT NULL
);

CREATE TABLE public.execution_runs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    run_name character varying(255),
    status character varying(50) DEFAULT 'pending'::character varying NOT NULL,
    browser character varying(50) DEFAULT 'chromium'::character varying NOT NULL,
    parallel_workers integer DEFAULT 1 NOT NULL,
    total_scripts integer DEFAULT 0 NOT NULL,
    passed_scripts integer DEFAULT 0 NOT NULL,
    failed_scripts integer DEFAULT 0 NOT NULL,
    triggered_by character varying(255),
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.execution_scripts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    master_script_id uuid NOT NULL,
    release_id uuid NOT NULL,
    module_id uuid NOT NULL,
    feature_id uuid,
    case_number character varying(50) NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    role character varying(255),
    script_type character varying(50) DEFAULT 'standard'::character varying NOT NULL,
    status character varying(20) DEFAULT 'valid'::character varying NOT NULL,
    labels text[] DEFAULT ARRAY[]::text[],
    published_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.execution_steps (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    execution_script_id uuid NOT NULL,
    master_step_id uuid,
    step_order integer NOT NULL,
    action_type character varying(100) NOT NULL,
    selector text,
    value text,
    description text,
    is_modified boolean DEFAULT false NOT NULL,
    is_added boolean DEFAULT false NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.imported_features (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    master_id uuid NOT NULL,
    module_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    abbreviation character varying(20),
    imported_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.imported_modules (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    master_id uuid NOT NULL,
    release_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    abbreviation character varying(20),
    imported_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.imported_processes (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    master_id uuid NOT NULL,
    module_id uuid NOT NULL,
    feature_id uuid,
    name character varying(255) NOT NULL,
    imported_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.imported_products (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    master_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    abbreviation character varying(20),
    imported_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.imported_releases (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    master_id uuid NOT NULL,
    product_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    imported_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.run_scripts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    run_id uuid NOT NULL,
    execution_script_id uuid NOT NULL
);

CREATE TABLE public.schedule_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    schedule_id uuid NOT NULL,
    test_run_id uuid,
    status character varying DEFAULT 'pending'::character varying NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    description text,
    target_type character varying NOT NULL,
    target_id uuid,
    execution_script_ids uuid[] DEFAULT '{}'::uuid[],
    parallel_workers integer DEFAULT 1 NOT NULL,
    screenshot_mode character varying DEFAULT 'on_failure'::character varying NOT NULL,
    max_retries integer DEFAULT 3 NOT NULL,
    retry_delay_seconds integer DEFAULT 30 NOT NULL,
    cron_expression character varying,
    scheduled_at timestamp with time zone,
    timezone character varying DEFAULT 'UTC'::character varying NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    status character varying DEFAULT 'pending'::character varying NOT NULL,
    last_run_at timestamp with time zone,
    last_run_status character varying,
    next_run_at timestamp with time zone,
    run_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.script_results (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    run_id uuid NOT NULL,
    execution_script_id uuid NOT NULL,
    status character varying(50) DEFAULT 'pending'::character varying NOT NULL,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    duration_ms integer,
    error_message text,
    error_stack text,
    video_path text,
    log_output text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE public.step_results (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    script_result_id uuid NOT NULL,
    execution_step_id uuid NOT NULL,
    step_order integer NOT NULL,
    status character varying(50) DEFAULT 'pending'::character varying NOT NULL,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    duration_ms integer,
    screenshot_b64 text,
    error_message text,
    actual_value text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE public.test_run_script_dependencies (
    test_run_id uuid NOT NULL,
    script_id uuid NOT NULL,
    depends_on_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT no_self_dependency CHECK ((script_id <> depends_on_id))
);

CREATE TABLE public.test_run_scripts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    test_run_id uuid NOT NULL,
    execution_script_id uuid NOT NULL,
    case_number character varying(50),
    name character varying(255),
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    screenshot_mode character varying(20) DEFAULT 'all'::character varying NOT NULL,
    total_steps integer DEFAULT 0 NOT NULL,
    passed_steps integer DEFAULT 0 NOT NULL,
    failed_steps integer DEFAULT 0 NOT NULL,
    duration_ms integer,
    error_summary text,
    started_at timestamp with time zone,
    ended_at timestamp with time zone
);

CREATE TABLE public.test_run_step_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    test_run_script_id uuid NOT NULL,
    test_run_step_id uuid,
    step_no integer NOT NULL,
    step_description character varying(500),
    action character varying(100),
    input_parameter character varying(500),
    input_value text,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    duration_ms integer,
    retry_count integer DEFAULT 0 NOT NULL,
    screenshot_b64 text,
    error_message text,
    executed_locator text
);

CREATE TABLE public.test_run_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    test_run_script_id uuid NOT NULL,
    execution_step_id uuid,
    step_no integer DEFAULT 0 NOT NULL,
    step_description text DEFAULT ''::text NOT NULL,
    action character varying(100) DEFAULT 'Action'::character varying NOT NULL,
    input_parameter character varying(500),
    input_type character varying(50),
    locator_code text,
    default_value text,
    wait_ms integer DEFAULT 0 NOT NULL,
    is_dropdown_open boolean DEFAULT false NOT NULL,
    is_option_selection boolean DEFAULT false NOT NULL,
    take_screenshot boolean DEFAULT true NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    is_manual boolean DEFAULT false NOT NULL,
    is_injected boolean DEFAULT false NOT NULL,
    is_modified boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.test_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(300) NOT NULL,
    description text,
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    browser character varying(30) DEFAULT 'chromium'::character varying NOT NULL,
    parallel_workers integer DEFAULT 1 NOT NULL,
    total_scripts integer DEFAULT 0 NOT NULL,
    passed_scripts integer DEFAULT 0 NOT NULL,
    failed_scripts integer DEFAULT 0 NOT NULL,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Primary Keys
ALTER TABLE ONLY public.exec_script_processes ADD CONSTRAINT exec_script_processes_pkey PRIMARY KEY (script_id, process_id);
ALTER TABLE ONLY public.execution_runs ADD CONSTRAINT execution_runs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.execution_scripts ADD CONSTRAINT execution_scripts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.execution_steps ADD CONSTRAINT execution_steps_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.execution_steps ADD CONSTRAINT execution_steps_execution_script_id_step_order_key UNIQUE (execution_script_id, step_order);
ALTER TABLE ONLY public.imported_features ADD CONSTRAINT imported_features_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.imported_features ADD CONSTRAINT imported_features_master_id_key UNIQUE (master_id);
ALTER TABLE ONLY public.imported_modules ADD CONSTRAINT imported_modules_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.imported_modules ADD CONSTRAINT imported_modules_master_id_key UNIQUE (master_id);
ALTER TABLE ONLY public.imported_processes ADD CONSTRAINT imported_processes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.imported_processes ADD CONSTRAINT imported_processes_master_id_key UNIQUE (master_id);
ALTER TABLE ONLY public.imported_products ADD CONSTRAINT imported_products_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.imported_products ADD CONSTRAINT imported_products_master_id_key UNIQUE (master_id);
ALTER TABLE ONLY public.imported_releases ADD CONSTRAINT imported_releases_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.imported_releases ADD CONSTRAINT imported_releases_master_id_key UNIQUE (master_id);
ALTER TABLE ONLY public.run_scripts ADD CONSTRAINT run_scripts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.run_scripts ADD CONSTRAINT run_scripts_run_id_execution_script_id_key UNIQUE (run_id, execution_script_id);
ALTER TABLE ONLY public.schedule_runs ADD CONSTRAINT schedule_runs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.schedules ADD CONSTRAINT schedules_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.script_results ADD CONSTRAINT script_results_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.step_results ADD CONSTRAINT step_results_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.test_run_script_dependencies ADD CONSTRAINT test_run_script_dependencies_pkey PRIMARY KEY (test_run_id, script_id, depends_on_id);
ALTER TABLE ONLY public.test_run_scripts ADD CONSTRAINT test_run_scripts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.test_run_step_results ADD CONSTRAINT test_run_step_results_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.test_run_steps ADD CONSTRAINT test_run_steps_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.test_runs ADD CONSTRAINT test_runs_pkey PRIMARY KEY (id);

-- Indexes
CREATE INDEX idx_exec_runs_status ON public.execution_runs USING btree (status);
CREATE INDEX idx_exec_scripts_master ON public.execution_scripts USING btree (master_script_id);
CREATE INDEX idx_exec_scripts_release ON public.execution_scripts USING btree (release_id);
CREATE INDEX idx_exec_steps_script ON public.execution_steps USING btree (execution_script_id, step_order);
CREATE INDEX idx_schedule_runs_schedule ON public.schedule_runs USING btree (schedule_id);
CREATE INDEX idx_schedule_runs_status ON public.schedule_runs USING btree (status);
CREATE INDEX idx_schedules_enabled ON public.schedules USING btree (is_enabled);
CREATE INDEX idx_schedules_status ON public.schedules USING btree (status);
CREATE INDEX idx_script_results_run ON public.script_results USING btree (run_id);
CREATE INDEX idx_step_results_result ON public.step_results USING btree (script_result_id);
CREATE INDEX idx_tr_scripts_exec ON public.test_run_scripts USING btree (execution_script_id);
CREATE INDEX idx_tr_scripts_run ON public.test_run_scripts USING btree (test_run_id);
CREATE INDEX idx_tr_step_results_step ON public.test_run_step_results USING btree (test_run_step_id);
CREATE INDEX idx_tr_step_results_trs ON public.test_run_step_results USING btree (test_run_script_id);
CREATE INDEX idx_tr_steps_script ON public.test_run_steps USING btree (test_run_script_id) WHERE (is_active = true);
CREATE INDEX idx_trs_deps_run ON public.test_run_script_dependencies USING btree (test_run_id);
CREATE INDEX idx_trs_deps_script ON public.test_run_script_dependencies USING btree (script_id);

-- Triggers
CREATE TRIGGER trg_exec_runs_upd BEFORE UPDATE ON public.execution_runs FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();
CREATE TRIGGER trg_exec_scripts_upd BEFORE UPDATE ON public.execution_scripts FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();
CREATE TRIGGER trg_exec_steps_upd BEFORE UPDATE ON public.execution_steps FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();

-- Foreign Keys
ALTER TABLE ONLY public.exec_script_processes ADD CONSTRAINT exec_script_processes_process_id_fkey FOREIGN KEY (process_id) REFERENCES public.imported_processes(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.exec_script_processes ADD CONSTRAINT exec_script_processes_script_id_fkey FOREIGN KEY (script_id) REFERENCES public.execution_scripts(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.execution_scripts ADD CONSTRAINT execution_scripts_feature_id_fkey FOREIGN KEY (feature_id) REFERENCES public.imported_features(id);
ALTER TABLE ONLY public.execution_scripts ADD CONSTRAINT execution_scripts_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.imported_modules(id);
ALTER TABLE ONLY public.execution_scripts ADD CONSTRAINT execution_scripts_release_id_fkey FOREIGN KEY (release_id) REFERENCES public.imported_releases(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.execution_steps ADD CONSTRAINT execution_steps_execution_script_id_fkey FOREIGN KEY (execution_script_id) REFERENCES public.execution_scripts(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.imported_features ADD CONSTRAINT imported_features_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.imported_modules(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.imported_modules ADD CONSTRAINT imported_modules_release_id_fkey FOREIGN KEY (release_id) REFERENCES public.imported_releases(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.imported_processes ADD CONSTRAINT imported_processes_feature_id_fkey FOREIGN KEY (feature_id) REFERENCES public.imported_features(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.imported_processes ADD CONSTRAINT imported_processes_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.imported_modules(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.imported_releases ADD CONSTRAINT imported_releases_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.imported_products(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.run_scripts ADD CONSTRAINT run_scripts_execution_script_id_fkey FOREIGN KEY (execution_script_id) REFERENCES public.execution_scripts(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.run_scripts ADD CONSTRAINT run_scripts_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.execution_runs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.schedule_runs ADD CONSTRAINT schedule_runs_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.schedules(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.script_results ADD CONSTRAINT script_results_execution_script_id_fkey FOREIGN KEY (execution_script_id) REFERENCES public.execution_scripts(id);
ALTER TABLE ONLY public.script_results ADD CONSTRAINT script_results_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.execution_runs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.step_results ADD CONSTRAINT step_results_execution_step_id_fkey FOREIGN KEY (execution_step_id) REFERENCES public.execution_steps(id);
ALTER TABLE ONLY public.step_results ADD CONSTRAINT step_results_script_result_id_fkey FOREIGN KEY (script_result_id) REFERENCES public.script_results(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.test_run_script_dependencies ADD CONSTRAINT test_run_script_dependencies_depends_on_id_fkey FOREIGN KEY (depends_on_id) REFERENCES public.test_run_scripts(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.test_run_script_dependencies ADD CONSTRAINT test_run_script_dependencies_script_id_fkey FOREIGN KEY (script_id) REFERENCES public.test_run_scripts(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.test_run_script_dependencies ADD CONSTRAINT test_run_script_dependencies_test_run_id_fkey FOREIGN KEY (test_run_id) REFERENCES public.test_runs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.test_run_scripts ADD CONSTRAINT test_run_scripts_execution_script_id_fkey FOREIGN KEY (execution_script_id) REFERENCES public.execution_scripts(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.test_run_scripts ADD CONSTRAINT test_run_scripts_test_run_id_fkey FOREIGN KEY (test_run_id) REFERENCES public.test_runs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.test_run_step_results ADD CONSTRAINT test_run_step_results_test_run_script_id_fkey FOREIGN KEY (test_run_script_id) REFERENCES public.test_run_scripts(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.test_run_step_results ADD CONSTRAINT test_run_step_results_test_run_step_id_fkey FOREIGN KEY (test_run_step_id) REFERENCES public.test_run_steps(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.test_run_steps ADD CONSTRAINT test_run_steps_execution_step_id_fkey FOREIGN KEY (execution_step_id) REFERENCES public.execution_steps(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.test_run_steps ADD CONSTRAINT test_run_steps_test_run_script_id_fkey FOREIGN KEY (test_run_script_id) REFERENCES public.test_run_scripts(id) ON DELETE CASCADE;