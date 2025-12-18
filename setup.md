Got you. Here is the **clean, repeatable guide** to set up a **veth pair + network namespace** so you can attach XDP on the host side and test traffic from the namespace. This is the exact setup you’ve been using (with `veth0`, `ns1`, `10.200.1.1/24`).

---

# 🧩 veth + namespace setup guide (XDP test lab)

> Goal:
> Traffic flows **ns1 → veth → host**, where XDP is attached.

---

## 0️⃣ Clean up first (safe to run)

```bash
sudo ip netns del ns1 2>/dev/null
sudo ip link del veth0 2>/dev/null
```

---

## 1️⃣ Create a network namespace

```bash
sudo ip netns add ns1
```

---

## 2️⃣ Create a veth pair

```bash
sudo ip link add veth0 type veth peer name veth1
```

* `veth0` → stays in host namespace (XDP attaches here)
* `veth1` → moves into `ns1`

---

## 3️⃣ Move one end into the namespace

```bash
sudo ip link set veth1 netns ns1
```

---

## 4️⃣ Assign IP addresses

### Host side (`veth0`)

```bash
sudo ip addr add 10.200.1.1/24 dev veth0
sudo ip link set veth0 up
```

### Namespace side (`veth1`)

```bash
sudo ip netns exec ns1 ip addr add 10.200.1.2/24 dev veth1
sudo ip netns exec ns1 ip link set veth1 up
sudo ip netns exec ns1 ip link set lo up
```

---

## 5️⃣ Verify connectivity (before XDP)

```bash
ping -c 1 10.200.1.2
sudo ip netns exec ns1 ping -c 1 10.200.1.1
```

✅ Both should succeed.

---

## 6️⃣ Start a UDP listener on the host

```bash
sudo nc -u -l -k -p 53 -s 10.200.1.1
```

(Use port `53` to test DNS drops, or `9999` for pass-through.)

---

## 7️⃣ Send a test packet from the namespace

```bash
sudo ip netns exec ns1 sh -c 'echo "TEST" | nc -u -w1 10.200.1.1 53'
```

* With **no XDP** → packet arrives
* With **XDP DNS-drop attached** → packet is dropped

---

## 8️⃣ Attach XDP to `veth0`

```bash
sudo ip link set dev veth0 xdp obj ./target/bpfel-unknown-none/release/af_xdp sec xdp
```

Verify:

```bash
ip -details link show dev veth0 | head -n 6
```

You should see:

```
prog/xdp id ...
```

---

## 9️⃣ Test DNS drop (with XDP)

```bash
sudo ip netns exec ns1 sh -c 'echo "DNS_TEST" | nc -u -w1 10.200.1.1 53'
```

❌ Nothing should arrive → drop confirmed

---

## 🔟 Detach XDP

```bash
sudo ip link set dev veth0 xdp off
```

Re-test:

```bash
sudo ip netns exec ns1 sh -c 'echo "DNS_AFTER_DETACH" | nc -u -w1 10.200.1.1 53'
```

✅ Packet arrives again

---

## 🧠 What this setup gives you

* Full control over traffic
* No interference from system services
* Deterministic testing
* Safe XDP attach/detach
* Works on any Linux system

---

## One-line takeaway

> **veth + namespace is the simplest, safest way to test XDP and AF_XDP locally.**

If you want next, I can:

* add **tcpdump verification**
* extend this to **AF_XDP sockets**
* convert it into a reusable shell script

Just say 👍
