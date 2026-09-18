-- A product is sold on one chain. The buyer's wallet does not get to choose it:
-- otherwise a mainnet product could be "paid" with worthless testnet NIM and still
-- produce a verified Passport and a Promise Ledger entry.
--
-- Existing rows are TestAlbatross because that is the only chain this deployment
-- has ever verified against.

alter table products
  add column if not exists network varchar(24) not null default 'TestAlbatross';

alter table products
  alter column network drop default;

alter table products
  drop constraint if exists products_network_not_blank;

alter table products
  add constraint products_network_not_blank check (btrim(network) <> '');

create index if not exists products_network_status_index on products (network, status);
