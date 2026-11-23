var ParryTrainerResultAudioPlaying = false;

function ParryTrainerPlayResultAudio(won) {
    ParryTrainerResultAudioPlaying = true;
    $.DispatchEvent('CitadelConCommand', 'parry_trainer_result_audio ' + (won ? 'win' : 'lose'));
}

function ParryTrainerStopResultAudio() {
    if (!ParryTrainerResultAudioPlaying) return;
    ParryTrainerResultAudioPlaying = false;
    $.DispatchEvent('CitadelConCommand', 'parry_trainer_result_audio stop');
}
