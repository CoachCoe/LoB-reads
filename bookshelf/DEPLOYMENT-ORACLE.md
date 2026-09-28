# Deploying to Oracle Cloud (Always Free)

One Ampere A1 VM runs everything: Postgres 16, the app, and Caddy, which
terminates TLS and serves uploads from disk. The files are in
[`infra/oracle/`](../infra/oracle/). The reasoning behind the Postgres settings,
the catalog sizes and the restore timings lives in [`DEPLOYMENT.md`](DEPLOYMENT.md),
which describes the Azure target; this document covers only what differs.

```
internet ──443──▶ caddy ──▶ app:3000 ──▶ postgres:5432
                    │
                    └── /uploads/* ◀── uploads volume ◀── app writes
```

Only Caddy publishes ports. The app trusts `X-Real-IP` for rate limiting
because Caddy overwrites it and nothing else can reach the app. Publishing the
app's port directly would let any client choose its own rate-limit bucket.

## The VM

| | |
| --- | --- |
| Shape | `VM.Standard.A1.Flex`, 4 OCPU, 24 GB. The AMD micro shapes have 1 GB, which does not hold the catalog's working set. |
| Image | Ubuntu 24.04, **aarch64**. The app image is built on the VM, so it is native ARM. |
| Boot volume | 100 GB. The database is about 11 GB; backups and the catalog dump need room beside it. Always Free allows 200 GB of block storage in total. |

A1 capacity is often exhausted ("Out of host capacity"). Retry, or try another
availability domain.

Always Free instances that stay idle for a week can be reclaimed. Upgrading the
account to Pay As You Go removes that, and usage inside the Always Free limits
is still not billed.

### Network

Two firewalls, and both have to allow 80 and 443:

1. **The subnet's security list** (or a network security group) in the console:
   ingress TCP 80 and 443 from `0.0.0.0/0`, plus UDP 443 for HTTP/3.
2. **The host's iptables.** Oracle's Ubuntu images ship rules that reject
   everything except SSH, and they survive reboots via
   `/etc/iptables/rules.v4`:

   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo iptables -I INPUT 6 -p udp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   ```

Do not open 5432 or 3000.

Point an `A` record for the domain at the VM's public IP **before** the first
deploy, because Caddy requests the certificate when it starts.

### Software

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # then log out and back in
git clone <repository> lob && cd lob
cp infra/oracle/env.example infra/oracle/.env   # and fill it in
```

## First deploy

```bash
infra/oracle/deploy.sh
```

This builds the image on the VM, starts Postgres, runs migrations, starts the
app and Caddy, then runs `deploy:verify` against the public URL. On the first
run, verify fails on "catalog has works", because the catalog is still empty.
Restore it and run verify again:

```bash
# on the machine that ran the ingest
pg_dump -d bookshelf -Fd -j 8 --schema=catalog -f catalog-dump
rsync -a catalog-dump/ <vm>:lob/infra/oracle/catalog-dump/

# on the VM
infra/oracle/restore-catalog.sh
infra/oracle/deploy.sh
```

Never run the ingest on the VM. See
[Do not run the ingest against Azure](DEPLOYMENT.md#do-not-run-the-ingest-against-azure);
the same reasoning applies here.

### Check that uploads render

`next/image` serves avatars and maps by fetching them from `CDN_URL`, which is
the site's own public URL. So the app container has to reach the VM's public
IP from inside it. `deploy:verify` does not exercise this. Check it once,
after uploading an avatar:

```bash
docker compose -f infra/oracle/compose.yml exec app \
  node -e "fetch(process.env.CDN_URL + '/').then(r => console.log(r.status))"
```

Any HTTP status means the route works; 404 is the expected answer for the
bare directory. A timeout means it does not.

## Updating

```bash
git pull && infra/oracle/deploy.sh
```

The app is down for the few seconds it takes to replace the container. There
is one replica by design: the rate limiter keeps its state in memory.

The monthly catalog rebuild uses the same dump and `restore-catalog.sh` as the
first deploy. `restore-catalog.sh` runs while the app is serving, and search
returns nothing until the restore finishes.

## Backups

`infra/oracle/backup.sh` dumps the `app` and `public` schemas and archives the
uploads into `/var/backups/lob`, keeping 14 days of each. The catalog is left
out because it can be rebuilt. Run it nightly:

```cron
0 3 * * * /home/ubuntu/lob/infra/oracle/backup.sh >> /var/log/lob-backup.log 2>&1
```

Those backups share a disk with the database, so they protect against a bad
migration or a deleted row, not against losing the volume. For that, attach a
backup policy to the boot volume in the console (Block Storage → Boot Volumes →
Backup Policies). Always Free includes five volume backups.

To restore the user data and uploads, with the app running:

```bash
infra/oracle/restore-backup.sh /var/backups/lob/db-<stamp>.dump
```

It restores the uploads archive with the same stamp alongside, and leaves the
catalog alone.
