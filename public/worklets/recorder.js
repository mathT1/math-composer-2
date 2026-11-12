// 마이크 입력을 그대로 모아 본체로 보낸다. 가공하지 않는다.
class Recorder extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor('recorder', Recorder);
