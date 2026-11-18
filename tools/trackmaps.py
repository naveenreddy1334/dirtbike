# Track-space surface maps (ruts, tread, clods, wetness).  u: across 13 m, v: along 32 m (tiles in v).
import numpy as np, cv2
from PIL import Image
OUT='/home/claude/game/assets/'
W,H=2048,4096; WM,LM=13.0,32.0
rng=np.random.default_rng(21)
s=((np.arange(W)+0.5)/W-0.5)*WM            # lateral metres
t=(np.arange(H)+0.5)/H*LM                  # along metres
S,T=np.meshgrid(s,t)                       # [row=t, col=s]
def spectral(shape,beta,seed,lo=0,hi=1e9,aniso=1.0):
    r=np.random.default_rng(seed); fy=np.fft.fftfreq(shape[0])[:,None]*shape[0]*aniso; fx=np.fft.fftfreq(shape[1])[None,:]*shape[1]*(shape[0]/shape[1]*LM/LM)
    f=np.sqrt(fx*fx+fy*fy); f[0,0]=1; amp=f**(-beta/2); amp[0,0]=0; amp[(f<lo)|(f>hi)]=0
    x=np.fft.ifft2(amp*np.exp(1j*r.uniform(0,2*np.pi,shape))).real; return (x/x.std()).astype(np.float32)
def per1d(n_terms,seed,amp=1.0,kmin=1,kmax=6):
    r=np.random.default_rng(seed); out=np.zeros(H,np.float32)
    for k in range(kmin,kmax+1):
        out+= r.normal(0,1.0/k)*np.sin(2*np.pi*k*t/LM+r.uniform(0,6.28))
    return out/np.abs(out).max()*amp
h=np.zeros((H,W),np.float32)
# broad unevenness + clods
h+=0.012*spectral((H,W),2.6,1,2,60)+0.006*spectral((H,W),1.6,2,40,400)+0.0025*spectral((H,W),0.8,3,300,1400)
# racing-line ruts
ruts=[]
for lane in (-1.6,1.6):
    for k in range(4):
        ruts.append(dict(s0=lane+rng.uniform(-0.55,0.55),depth=rng.uniform(0.035,0.075),w=rng.uniform(0.055,0.10),mean=1.0,seed=int(rng.integers(1e6))))
for k in range(9):
    ruts.append(dict(s0=rng.uniform(-4.4,4.4),depth=rng.uniform(0.015,0.04),w=rng.uniform(0.05,0.09),mean=0.45,seed=int(rng.integers(1e6))))
rutmask=np.zeros((H,W),np.float32); tread=np.zeros((H,W),np.float32)
for r in ruts:
    c=r['s0']+per1d(5,r['seed'],0.32,1,5)                       # meandering centre line (m), periodic along the track
    pres=np.clip(r['mean']+per1d(4,r['seed']+1,0.8,1,4),0,1)     # presence along the track
    d=S-c[:,None]; g=np.exp(-(d*d)/(2*r['w']**2))
    lip=np.exp(-((np.abs(d)-2.1*r['w'])**2)/(2*(0.8*r['w'])**2))
    h+=(-r['depth']*g+0.32*r['depth']*lip)*pres[:,None]
    rutmask=np.maximum(rutmask,g*pres[:,None])
    # knobby tread imprint along the rut floor
    ph=(T/0.062+rng.uniform(0,1)); blk=(np.modf(ph)[0]<0.55).astype(np.float32)
    lat=np.cos(np.clip(d/(r['w']*0.9),-1,1)*np.pi*2.5)
    tread+= g*pres[:,None]*blk*(0.5+0.5*lat)
h+=-0.004*np.clip(tread,0,1.5)
# loose dirt pushed to the edges
edge=np.exp(-((np.abs(S)-5.35)**2)/(2*0.42**2))
h+=edge*(0.05+0.035*spectral((H,W),2.0,7,3,80))
h=cv2.GaussianBlur(h,(0,0),0.8)
# wetness: rut floors + low-frequency damp patches -> puddles in the deepest parts
lowf=spectral((H,W),3.2,9,1,7)
damp=np.clip((-h-0.012)/0.03,0,1)*0.8+np.clip(lowf*0.5-0.1,0,1)*0.6
water_level=-0.036+0.012*(1-np.clip(lowf*0.6+0.4,0,1))
puddle=np.clip((water_level-h)/0.006,0,1)*np.clip(lowf*0.8+0.55,0,1)
wet=np.clip(0.5*np.clip(damp,0,1)+0.5*puddle,0,1)                # 0 dry .. 0.5 damp .. 1 standing water
wet*=(np.abs(S)<5.6)
# normals from the height field (metres per metre)
px=WM/W; py=LM/H
gx=(np.roll(h,-1,1)-np.roll(h,1,1))/(2*px); gy=(np.roll(h,-1,0)-np.roll(h,1,0))/(2*py)
gx[:,0]=gx[:,1]; gx[:,-1]=gx[:,-2]
n=np.stack([-gx,-gy,np.ones_like(h)],-1); n/=np.linalg.norm(n,axis=-1,keepdims=True)
hn=np.clip((h+0.09)/0.18,0,1)
cav=np.clip(0.5+(h-cv2.GaussianBlur(h,(0,0),9))*14,0,1)        # cavity / ambient occlusion-ish
var=np.clip(0.5+0.25*spectral((H,W),2.2,11,2,50)+0.12*spectral((H,W),1.0,12,60,600),0,1)
A=np.dstack([n[...,0]*0.5+0.5,n[...,1]*0.5+0.5,hn])
B=np.dstack([wet,cav,var])
# image row 0 = v max in GL (flipY); we store row r <-> t increasing downward and flip in the shader via uv
Image.fromarray((np.clip(A,0,1)*255).astype(np.uint8)).save(OUT+'track_a.webp',quality=92,method=5)
Image.fromarray((np.clip(B,0,1)*255).astype(np.uint8)).save(OUT+'track_b.webp',quality=88,method=5)
import os; print(os.path.getsize(OUT+'track_a.webp')//1024, os.path.getsize(OUT+'track_b.webp')//1024, 'KB; puddle frac %.3f damp frac %.3f'%((wet>0.75).mean(),(wet>0.3).mean()), 'h range',h.min(),h.max())
# preview: crude lit render of an 13 x 13 m patch
crop=slice(0,2048)
l=np.array([0.5,0.6,0.62]); l/=np.linalg.norm(l)
sh=np.clip((n[crop]*l).sum(-1),0,1)
col=np.array([0.42,0.30,0.2])[None,None]*(0.55+0.6*sh[...,None])*(1-0.55*wet[crop][...,None])
col=col*(1-puddle[crop][...,None])+np.array([0.75,0.8,0.9])[None,None]*puddle[crop][...,None]*0.8
Image.fromarray((np.clip(col,0,1)**(1/2.2)*255).astype(np.uint8)).resize((1024,1024),Image.LANCZOS).save('/home/claude/preview/track_patch.jpg',quality=90)
