# Offline sky preparation: roll the HDRI so the sun sits at a chosen world azimuth,
# build a clamped low-res IBL version with a ground-bounce lower hemisphere, and
# extract horizon haze colours for the fog model.
import cv2, numpy as np, json, os
SRC='/home/claude/assets_src/gkjohnson_3d-demo-data/hdri/wasteland_clouds_puresky_2k.hdr'
OUT='/home/claude/game/assets/'
SUN_AZ_TARGET=-35.0   # degrees, atan2(z,x) in world space
im=cv2.imread(SRC, cv2.IMREAD_UNCHANGED).astype(np.float32)  # BGR
h,w=im.shape[:2]
lum=im[...,0]*0.0722+im[...,1]*0.7152+im[...,2]*0.2126
bl=cv2.GaussianBlur(lum,(0,0),2)
iy,ix=np.unravel_index(np.argmax(bl),bl.shape)
# refine with centroid of the top region
ys,xs=np.mgrid[max(0,iy-12):iy+13, ix-12:ix+13]
wgt=np.maximum(bl[ys,xs]-bl[iy,ix]*0.5,0)
cy=(wgt*ys).sum()/wgt.sum(); cx=(wgt*xs).sum()/wgt.sum()
az=(cx+0.5)/w*360-180; el=90-(cy+0.5)/h*180
print('sun src az %.2f el %.2f peak %.1f'%(az,el,lum.max()))
shift=int(round((SUN_AZ_TARGET-az)/360*w))
im=np.roll(im,shift,axis=1); lum=np.roll(lum,shift,axis=1)
sun_az=az+shift/w*360; sun_el=el
print('sun dst az %.2f el %.2f'%(sun_az,sun_el))
# --- stats
v=(np.arange(h)+0.5)/h; elev=(0.5-v)*np.pi          # +pi/2 top
cosw=np.cos(elev)[:,None]
up=elev>0
sinw=np.sin(np.clip(elev,0,None))[:,None]
# cosine-weighted irradiance from the sky on a horizontal plane (per channel), excluding the sun core
sunmask=lum>np.percentile(lum,99.97)
sky=im.copy(); sky[sunmask]=np.percentile(lum,99.5)
dw=(np.pi/h)*(2*np.pi/w)
E_sky=(sky*cosw[...,None]*sinw[...,None]).sum((0,1))*dw      # BGR irradiance
cw2=np.repeat(cosw,w,axis=1)
E_sun_dir=(im[sunmask]*cw2[sunmask][:,None]).sum(0)*dw   # radiance*solid angle of the clipped sun core
mean_up=(sky[up]*cw2[up][:,:,None]).sum((0,1))/cw2[up].sum()
print('E_sky(RGB)',E_sky[::-1],'mean sky radiance(RGB)',mean_up[::-1],'clipped sun flux',E_sun_dir[::-1])
# --- horizon colours (16 azimuth bins, band 0.6..4.5 deg elevation)
rows=np.where((elev>np.radians(0.6))&(elev<np.radians(4.5)))[0]
band=sky[rows].mean(0)                 # (w,3) BGR
def wrapblur(b,sig):
    t=np.concatenate([b,b,b],0)[None].astype(np.float32)
    return cv2.GaussianBlur(t,(0,0),sig)[0][len(b):2*len(b)]
band=wrapblur(band,w/64.0)
NB=16; hz=[]
for i in range(NB):
    phi=-180+360*i/NB                  # bin centre azimuth (deg), atan2(z,x)
    x=int(((phi+180)/360*w))%w
    hz.append([float(band[x,2]),float(band[x,1]),float(band[x,0])])
# band slightly higher for "upper haze"
rows2=np.where((elev>np.radians(8))&(elev<np.radians(14)))[0]
band2=wrapblur(sky[rows2].mean(0),w/64.0)
hz2=[[float(band2[int(((-180+360*i/NB+180)/360*w))%w,c]) for c in (2,1,0)] for i in range(NB)]
zen=sky[:h//8].mean((0,1))[::-1]
# --- visible sky: keep upper hemisphere, fill below horizon with the horizon band colour fading darker
vis=im.copy()
hrow=h//2
for y in range(hrow,h):
    t=min(1.0,(y-hrow)/(h*0.06))
    vis[y]=band*(1-0.55*t)
vis=np.minimum(vis, 4000.0)
cv2.imwrite(OUT+'sky.hdr',vis)
# --- IBL: 512x256, sun clamped, lower hemisphere = ground bounce
ibl=cv2.resize(np.minimum(im,24.0),(512,256),interpolation=cv2.INTER_AREA)
ground_alb=np.array([0.075,0.115,0.16],np.float32)   # BGR, dry dirt/grass
bounce=ground_alb*(E_sky/np.pi)*1.25
hb=cv2.resize(band[None],(512,1),interpolation=cv2.INTER_AREA)[0]
for y in range(128,256):
    t=min(1.0,(y-128)/14.0)
    ibl[y]=hb*(1-t)*0.8+bounce*(0.2+0.8*t)
cv2.imwrite(OUT+'sky_ibl.hdr',ibl)
meta=dict(sunAz=float(sun_az),sunEl=float(sun_el),E_sky=[float(x) for x in E_sky[::-1]],meanSky=[float(x) for x in mean_up[::-1]],horizon=hz,horizonHi=hz2,zenith=[float(x) for x in zen])
json.dump(meta,open('/home/claude/game/work/sky.json','w'),indent=1)
print(json.dumps(meta)[:900])
# previews
def tm(a,ex=0.7):
    t=a*ex; t=t/(1+t); return (np.clip(t,0,1)**(1/2.2)*255).astype(np.uint8)
cv2.imwrite('/home/claude/preview/sky_vis.jpg',cv2.resize(tm(vis),(1280,640)))
cv2.imwrite('/home/claude/preview/sky_ibl.jpg',cv2.resize(tm(ibl),(1024,512),interpolation=cv2.INTER_NEAREST))
print(os.path.getsize(OUT+'sky.hdr'),os.path.getsize(OUT+'sky_ibl.hdr'))
