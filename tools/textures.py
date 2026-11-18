# Prepare ground texture layers: albedo JPG + (normal.xy, height) WebP per layer.
import numpy as np, cv2, json
from PIL import Image
PC='/home/claude/assets_src/playcanvas_engine/examples/assets/textures/'
OUT='/home/claude/game/assets/'
S=1024
def load(p):
    return np.asarray(Image.open(p).convert('RGB').resize((S,S),Image.LANCZOS)).astype(np.float32)/255.0
def srgb2lin(c): return np.where(c<=0.04045,c/12.92,((c+0.055)/1.055)**2.4)
def height_from_normal(nm):
    n=nm*2-1; nz=np.maximum(n[...,2],0.08); p=-n[...,0]/nz; q=n[...,1]/nz      # dh/dx, dh/drow
    fx=np.fft.fftfreq(S)[None,:]*2*np.pi; fy=np.fft.fftfreq(S)[:,None]*2*np.pi
    den=fx*fx+fy*fy; den[0,0]=1
    Hh=(-1j*fx*np.fft.fft2(p)-1j*fy*np.fft.fft2(q))/den; Hh[0,0]=0
    h=np.fft.ifft2(Hh).real
    lo,hi=np.percentile(h,1),np.percentile(h,99)
    return np.clip((h-lo)/(hi-lo),0,1)
def normal_from_height(h,strength):
    gx=(np.roll(h,-1,1)-np.roll(h,1,1))*0.5*strength; gy=(np.roll(h,-1,0)-np.roll(h,1,0))*0.5*strength
    n=np.stack([-gx,gy,np.ones_like(h)],-1); n/=np.linalg.norm(n,axis=-1,keepdims=True)   # GL: +y up = -row
    return n*0.5+0.5
def spectral(n,beta,seed,lo=0,hi=1e9):
    r=np.random.default_rng(seed); fx=np.fft.fftfreq(n)[:,None]*n; fy=np.fft.fftfreq(n)[None,:]*n
    f=np.sqrt(fx*fx+fy*fy); f[0,0]=1; amp=f**(-beta/2); amp[0,0]=0; amp[(f<lo)|(f>hi)]=0
    x=np.fft.ifft2(amp*np.exp(1j*r.uniform(0,2*np.pi,(n,n)))).real; return x/x.std()
layers=[]
def add(name,alb,nrm=None,hstrength=6.0,hfrom='nrm'):
    if nrm is None:
        lum=cv2.GaussianBlur((alb@np.array([0.3,0.59,0.11],np.float32)),(0,0),1.0)
        h=(lum-lum.min())/(lum.max()-lum.min()); nrm=normal_from_height(h,hstrength)
    else:
        h=height_from_normal(nrm)
    i=len(layers)
    Image.fromarray((np.clip(alb,0,1)*255).astype(np.uint8)).save(OUT+f'gl_alb_{i}.jpg',quality=90)
    nh=np.dstack([nrm[...,0],nrm[...,1],h])
    Image.fromarray((np.clip(nh,0,1)*255).astype(np.uint8)).save(OUT+f'gl_nh_{i}.webp',quality=93,method=6)
    mean=srgb2lin(alb).reshape(-1,3).mean(0)
    layers.append(dict(name=name,mean=[float(x) for x in mean]))
    print(i,name,'mean lin',mean.round(3))
add('meadow_detail',load(PC+'terrain/sparse_grass_diff_1k.jpg'),load(PC+'terrain/sparse_grass_nor_1k.jpg'))
add('meadow_macro',load(PC+'terrain/aerial_grass_rock_diff_1k.jpg'),load(PC+'terrain/aerial_grass_rock_nor_1k.jpg'))
add('dirt_macro',load(PC+'terrain/dirt_aerial_02_diff_1k.jpg'),load(PC+'terrain/dirt_aerial_02_nor_1k.jpg'))
add('gravel_detail',load(PC+'rocky_trail_diff_1k.jpg'),None,7.0)
add('rock',load(PC+'terrain/rock_face_03_diff_1k.jpg'),load(PC+'terrain/rock_face_03_nor_1k.jpg'))
add('rock_aerial',load(PC+'terrain/aerial_rocks_02_diff_1k.jpg'),load(PC+'terrain/aerial_rocks_02_nor_1k.jpg'))
# procedural loam / mud detail (tileable)
rng=np.random.default_rng(5)
h=0.55*spectral(S,2.3,1,3,400)+0.35*spectral(S,1.2,2,40,500)
clod=np.zeros((S,S),np.float32)
for _ in range(1400):
    r=rng.uniform(2.5,11); x,y=rng.uniform(0,S,2); a=rng.uniform(0.4,1.0)
    for ox in (-S,0,S):
        for oy in (-S,0,S):
            if -30<x+ox<S+30 and -30<y+oy<S+30: cv2.circle(clod,(int(x+ox),int(y+oy)),int(r),float(a),-1,cv2.LINE_AA)
clod=cv2.GaussianBlur(clod,(0,0),1.6)
hh=h*0.5+clod*1.6; hh=(hh-hh.min())/(hh.max()-hh.min())
tone=0.5+0.5*np.tanh(spectral(S,2.6,3,1,12)*0.9)
base=np.array([0.47,0.36,0.27],np.float32)[None,None]*(0.72+0.5*hh[...,None])
base=base*(0.9+0.2*tone[...,None])+np.array([0.05,0.02,0.0])[None,None]*(tone[...,None]-0.5)
base+= (spectral(S,0.6,4,80,512)*0.025)[...,None]
add('loam_detail',np.clip(base,0,1).astype(np.float32),None,0,'h')
# overwrite loam normal/height from the real height field
nrm=normal_from_height(hh,26.0); i=len(layers)-1
Image.fromarray((np.clip(np.dstack([nrm[...,0],nrm[...,1],hh]),0,1)*255).astype(np.uint8)).save(OUT+f'gl_nh_{i}.webp',quality=93,method=6)
json.dump(layers,open('/home/claude/game/work/layers.json','w'),indent=1)
import os; print({f:os.path.getsize(OUT+f)//1024 for f in sorted(os.listdir(OUT)) if f.startswith('gl_') or f.startswith('rock')})
# preview of loam
Image.fromarray((np.clip(np.hstack([base, np.dstack([nrm[...,0],nrm[...,1],nrm[...,2]])]),0,1)*255).astype(np.uint8)).resize((1024,512)).save('/home/claude/preview/loam.jpg')
