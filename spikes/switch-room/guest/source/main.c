// SPDX-License-Identifier: AGPL-3.0-only
// Switch homebrew fixture: four independent pads, moving pixels, stereo,
// vibration and a private SD-card counter. No commercial content or keys.
#include <switch.h>
#include <math.h>
#include <malloc.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define WIDTH 1280
#define HEIGHT 720
#define AUDIO_FRAMES 960
static atomic_bool running = true;
static atomic_uint audio_error = 0;

static void audio_loop(void *unused) {
    (void)unused;
    Result result = audoutInitialize();
    if (R_FAILED(result)) { atomic_store(&audio_error, result); return; }
    result = audoutStartAudioOut();
    if (R_FAILED(result)) { atomic_store(&audio_error, result); audoutExit(); return; }
    const size_t capacity = (AUDIO_FRAMES * 4 + 4095) & ~4095;
    s16 *samples = memalign(4096, capacity);
    if (!samples) { atomic_store(&audio_error, 1); audoutStopAudioOut(); audoutExit(); return; }
    AudioOutBuffer buffer = {.buffer = samples, .buffer_size = capacity, .data_size = AUDIO_FRAMES * 4};
    u64 frame = 0;
    while (atomic_load(&running)) {
        for (u32 i = 0; i < AUDIO_FRAMES; i++, frame++) {
            samples[2*i] = (s16)(6000 * sin(2 * M_PI * 440 * (double)frame / 48000));
            samples[2*i+1] = (s16)(6000 * sin(2 * M_PI * 880 * (double)frame / 48000));
        }
        AudioOutBuffer *released = NULL;
        result = audoutPlayBuffer(&buffer, &released);
        if (R_FAILED(result)) { atomic_store(&audio_error, result); break; }
    }
    audoutStopAudioOut();
    audoutExit();
    free(samples);
}

static void rect(u32 *pixels, u32 stride, u32 x, u32 y, u32 w, u32 h, u32 color) {
    for (u32 row = y; row < y+h && row < HEIGHT; row++)
        for (u32 col = x; col < x+w && col < WIDTH; col++) pixels[row*stride/4+col] = color;
}

int main(int argc, char **argv) {
    (void)argc; (void)argv;
    padConfigureInput(4, HidNpadStyleSet_NpadStandard);
    PadState pads[4];
    HidVibrationDeviceHandle vibration[4];
    bool can_vibrate[4];
    for (int i=0; i<4; i++) {
        padInitialize(&pads[i], (HidNpadIdType)i);
        can_vibrate[i] = R_SUCCEEDED(hidInitializeVibrationDevices(&vibration[i], 1, (HidNpadIdType)i, HidNpadStyleTag_NpadFullKey));
    }
    unsigned visits = 0;
    FILE *save = fopen("sdmc:/nel3ab-probe.bin", "rb");
    if (save) { if (fread(&visits, sizeof(visits), 1, save) != 1) visits=0; fclose(save); }
    visits++;
    bool saved = false;
    save = fopen("sdmc:/nel3ab-probe.bin", "wb");
    if (save) { saved = fwrite(&visits, sizeof(visits), 1, save) == 1; saved = fclose(save)==0 && saved; }

    Framebuffer fb;
    Result result = framebufferCreate(&fb, nwindowGetDefault(), WIDTH, HEIGHT, PIXEL_FORMAT_RGBA_8888, 2);
    if (R_FAILED(result)) return 2;
    result = framebufferMakeLinear(&fb);
    if (R_FAILED(result)) { framebufferClose(&fb); return 3; }
    Thread audio;
    result = threadCreate(&audio, audio_loop, NULL, NULL, 64*1024, 0x2c, -2);
    bool audio_thread = R_SUCCEEDED(result);
    if (audio_thread) { result=threadStart(&audio); audio_thread=R_SUCCEEDED(result); }
    if (!audio_thread) atomic_store(&audio_error, 2);
    const u32 colors[4] = {0xff202080,0xff208020,0xff802020,0xff208080};
    unsigned frame = 0;
    while (appletMainLoop()) {
        for (int i=0; i<4; i++) padUpdate(&pads[i]);
        if (padGetButtonsDown(&pads[0]) & HidNpadButton_Plus) break;
        u32 stride;
        u32 *pixels = framebufferBegin(&fb, &stride);
        for (int i=0; i<4; i++) {
            u32 x=(i%2)*640, y=(i/2)*320+40;
            rect(pixels,stride,x,y,640,320,colors[i]);
            rect(pixels,stride,x+8,y+8,24,24,padIsConnected(&pads[i])?0xffffffff:0xff000000);
            const u64 buttons=padGetButtons(&pads[i]);
            for (int bit=0;bit<16;bit++) rect(pixels,stride,x+40+bit*32,y+24,24,24,(buttons&(1ULL<<bit))?0xffffffff:0xff101010);
            for (int stick=0;stick<2;stick++) {
                HidAnalogStickState a=padGetStickPos(&pads[i],stick);
                rect(pixels,stride,x+160+stick*300+a.x/512,y+160-a.y/512,12,12,0xffffffff);
            }
            rect(pixels,stride,x+(frame*4)%620,y+286,20,14,0xffffffff);
            if (can_vibrate[i] && ((padGetButtonsDown(&pads[i])|padGetButtonsUp(&pads[i]))&HidNpadButton_A)) {
                HidVibrationValue value = {.freq_low=160,.freq_high=320,.amp_low=(buttons&HidNpadButton_A)?0.7f:0,.amp_high=0};
                hidSendVibrationValue(vibration[i], &value);
            }
        }
        rect(pixels,stride,0,0,WIDTH,40,0xff000000);
        for (int bit=0;bit<16;bit++) rect(pixels,stride,bit*32+8,8,24,24,(frame&(1u<<bit))?0xffffffff:0xff101010);
        rect(pixels,stride,0,680,WIDTH,40,0xff000000);
        for (int bit=0;bit<16;bit++) rect(pixels,stride,bit*32+8,688,24,24,(visits&(1u<<bit))?0xffffffff:0xff101010);
        rect(pixels,stride,600,688,24,24,saved?0xff00ff00:0xff0000ff);
        rect(pixels,stride,650,688,24,24,atomic_load(&audio_error)==0?0xff00ff00:0xff0000ff);
        framebufferEnd(&fb);
        frame++;
    }
    atomic_store(&running,false);
    if (audio_thread) { threadWaitForExit(&audio); threadClose(&audio); }
    framebufferClose(&fb);
    return 0;
}
