-- Supabase-Projekt „Assistants“: eine Datenbank für ALLE Demo-Assistenten.
-- Jede Zeile gehört zu einer Firma (company_id → companies.id = "id" aus tenant/company.json).
-- Bereits im Projekt angewendet (Migrationen assistants_companies_and_leads, companies_public_read).
-- Hier nur zur Dokumentation bzw. für ein neues Projekt.

create table public.companies (
  id          text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  name        text not null,
  website     text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.leads (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  company_id  text not null references public.companies(id) on update cascade,
  source      text not null check (source in ('chat', 'call')),
  name        text not null check (char_length(name) between 2 and 80),
  phone       text not null check (char_length(phone) between 6 and 40),
  district    text check (char_length(district) <= 80),
  concern     text check (char_length(concern) <= 400),
  language    text check (char_length(language) <= 10),
  status      text not null default 'neu' check (status in ('neu', 'in_arbeit', 'erledigt', 'spam'))
);
create index leads_company_created_idx on public.leads (company_id, created_at desc);

alter table public.companies enable row level security;
alter table public.leads enable row level security;

-- Publishable Key: darf nur neue Anfragen anlegen, nichts lesen. Secret Key umgeht RLS.
create policy "leads_insert_only" on public.leads
  for insert to anon, authenticated
  with check (status = 'neu' and exists (select 1 from public.companies c where c.id = company_id and c.active));

create policy "companies_read_active" on public.companies
  for select to anon, authenticated
  using (active);

insert into public.companies (id, name, website) values
  ('veritas', 'VERITAS Pflegedienst Berlin', 'https://veritas24.info'),
  ('dakos',   'Pflegedienst DAKOS',          'https://www.pflegedienst-dakos.de');

-- Neue Demo-Firma hinzufügen:
-- insert into public.companies (id, name, website) values ('firmen-id', 'Name', 'https://…');
