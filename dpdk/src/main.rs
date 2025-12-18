use std::{ffi::CString, ptr};

const BURST: u16 = 32;
const IPPROTO_UDP: u8 = 17;

#[repr(C)]
struct EtherHdr {
    dst: [u8; 6],
    src: [u8; 6],
    ether_type: u16,
}

#[repr(C)]
struct Ipv4Hdr {
    version_ihl: u8,
    tos: u8,
    total_length: u16,
    packet_id: u16,
    fragment_offset: u16,
    time_to_live: u8,
    next_proto_id: u8,
    hdr_checksum: u16,
    src_addr: u32,
    dst_addr: u32,
}

#[repr(C)]
struct UdpHdr {
    src_port: u16,
    dst_port: u16,
    dgram_len: u16,
    dgram_cksum: u16,
}

// You’d normally import these from a dpdk-sys crate.
// Here they’re declared to show the concrete calls.
#[allow(non_camel_case_types)]
type rte_mbuf = core::ffi::c_void;

extern "C" {
    fn rte_eal_init(argc: i32, argv: *mut *mut i8) -> i32;
    fn rte_eth_dev_count_avail() -> u16;
    fn rte_eth_dev_configure(port_id: u16, rx_queues: u16, tx_queues: u16, conf: *const core::ffi::c_void) -> i32;
    fn rte_eth_rx_queue_setup(port_id: u16, rx_queue_id: u16, nb_rx_desc: u16, socket_id: u32, rx_conf: *const core::ffi::c_void, mb_pool: *mut core::ffi::c_void) -> i32;
    fn rte_eth_tx_queue_setup(port_id: u16, tx_queue_id: u16, nb_tx_desc: u16, socket_id: u32, tx_conf: *const core::ffi::c_void) -> i32;
    fn rte_eth_dev_start(port_id: u16) -> i32;

    fn rte_eth_rx_burst(port_id: u16, queue_id: u16, rx_pkts: *mut *mut rte_mbuf, nb_pkts: u16) -> u16;
    fn rte_pktmbuf_free(m: *mut rte_mbuf);

    fn rte_pktmbuf_mtod(m: *mut rte_mbuf) -> *mut u8;
}

fn be16(x: u16) -> u16 {
    u16::from_be(x)
}

fn main() {
    unsafe {
        // EAL init (normally you pass real DPDK args like -l, -n, --proc-type, etc.)
        let arg0 = CString::new("dpdk-drop-dns").unwrap();
        let mut argv = vec![arg0.into_raw(), ptr::null_mut()];
        let rc = rte_eal_init(1, argv.as_mut_ptr());
        if rc < 0 {
            panic!("rte_eal_init failed");
        }

        let ports = rte_eth_dev_count_avail();
        if ports == 0 {
            panic!("No DPDK ports available");
        }

        let port_id: u16 = 0;

        // In a real program you must create an mbuf pool and configure port/queues properly.
        // This is the packet-loop example you asked for, not a full bring-up script.

        println!("DPDK ready. Polling port {port_id} and dropping UDP dst port 53…");

        let mut pkts: [*mut rte_mbuf; BURST as usize] = [ptr::null_mut(); BURST as usize];

        loop {
            let n = rte_eth_rx_burst(port_id, 0, pkts.as_mut_ptr(), BURST);
            for i in 0..n as usize {
                let m = pkts[i];
                if m.is_null() {
                    continue;
                }

                let data = rte_pktmbuf_mtod(m) as *const u8;
                if data.is_null() {
                    rte_pktmbuf_free(m);
                    continue;
                }

                let eth = &*(data as *const EtherHdr);
                let ether_type = be16(eth.ether_type);
                if ether_type != 0x0800 {
                    // Not IPv4
                    // forward or drop; for demo we drop unknown
                    rte_pktmbuf_free(m);
                    continue;
                }

                let ip = &*((data.add(core::mem::size_of::<EtherHdr>())) as *const Ipv4Hdr);
                if ip.next_proto_id != IPPROTO_UDP {
                    rte_pktmbuf_free(m);
                    continue;
                }

                let ihl = (ip.version_ihl & 0x0f) as usize * 4;
                let udp_ptr = data
                    .add(core::mem::size_of::<EtherHdr>() + ihl) as *const UdpHdr;

                let udp = &*udp_ptr;
                let dst = be16(udp.dst_port);

                if dst == 53 {
                    // DROP DNS
                    rte_pktmbuf_free(m);
                    continue;
                }

                // In a real app, you would TX it out another port/queue:
                // rte_eth_tx_burst(...)
                // For this demo, drop everything else too:
                rte_pktmbuf_free(m);
            }
        }
    }
}
