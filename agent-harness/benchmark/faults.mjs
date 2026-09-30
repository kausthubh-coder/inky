// Turns --fault flags into the fake school's fault plan:
//   slow:/mod/.*=4000              pages whose path matches wait 4 s
//   expire-session@after:30        sign the student out after 30 page requests
//   expire-session:statistics@after:20   the same, on one service
//   deadline-change@minute:3       move a deadline three minutes in
export function parseFaults(specs = []) {
  return specs.map(spec => {
    const slow = /^slow:(.+)=(\d+)$/.exec(spec);
    if (slow) return { slow: slow[1], ms: Number(slow[2]) };
    const event = /^([a-z-]+)(?::([a-z]+))?@(after|minute):(\d+(?:\.\d+)?)$/.exec(spec);
    if (!event) throw new Error(`Unknown fault “${spec}”. Use slow:<path regex>=<ms> or <event>[:service]@after:<requests>|minute:<n>.`);
    const [, name, service, when, value] = event;
    return { event: name, ...(service ? { service } : {}), ...(when === "after" ? { afterRequests: Number(value) } : { atMinute: Number(value) }) };
  });
}
