/** Checks actual bytes, the rate bound and bounded buffering before a network experiment. */
import assert from 'node:assert/strict';
import net from 'node:net';
import { limitedLink } from './limited-link.mjs';
const content=Buffer.alloc(300000,7);
const upstream=net.createServer(socket=>socket.end(content));
await new Promise(done=>upstream.listen(0,'127.0.0.1',done));
const portServer=net.createServer();await new Promise(done=>portServer.listen(0,'127.0.0.1',done));
const port=portServer.address().port;await new Promise(done=>portServer.close(done));
const link=await limitedLink({port,toPort:upstream.address().port});link.squeeze(1);
const start=performance.now();let data=[];
try {
 await new Promise((done,no)=>{const c=net.connect(port,'127.0.0.1');c.on('data',b=>data.push(b));c.on('end',done);c.on('error',no);});
 assert.deepEqual(Buffer.concat(data),content);
 assert.ok(performance.now()-start>=2300);
 assert.ok(link.stats().maximumQueued<=65536);
 console.log('PASS bounded link',Math.round(performance.now()-start),link.stats());
}finally{link.close();upstream.close();}
