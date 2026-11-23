use std::{env, error::Error, path::PathBuf};
fn main() -> Result<(), Box<dyn Error>> {
    let output = env::args_os()
        .nth(1)
        .ok_or("usage: native-arena <output.vpk>")?;
    build_parry_trainer_map::build_arena(&PathBuf::from(output))
}
