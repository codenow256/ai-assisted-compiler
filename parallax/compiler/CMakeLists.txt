cmake_minimum_required(VERSION 3.16)
project(parallax_compiler LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

find_package(BISON 3.6 REQUIRED)
find_package(FLEX 2.6 REQUIRED)

set(GEN_DIR ${CMAKE_CURRENT_BINARY_DIR}/generated)
file(MAKE_DIRECTORY ${GEN_DIR})

# --report writes parser.output (LR states, items, rules); the backend reads
# it to explain parser states and grammar rules in the UI.
BISON_TARGET(MiniCParser grammar/minic.y ${GEN_DIR}/minic_parser.cpp
  DEFINES_FILE ${GEN_DIR}/minic_parser.hpp
  REPORT_FILE ${CMAKE_CURRENT_BINARY_DIR}/parser.output
  COMPILE_FLAGS "-Wall --report=state,itemset,lookahead")
FLEX_TARGET(MiniCLexer grammar/minic.l ${GEN_DIR}/minic_lexer.cpp)

add_library(parallax_core STATIC
  src/token.cpp
  src/ast.cpp
  src/json.cpp
  src/names.cpp
  src/repair_stream.cpp
  src/repair_engine.cpp
  src/serialize.cpp
  ${BISON_MiniCParser_OUTPUTS}
  ${FLEX_MiniCLexer_OUTPUTS})
target_include_directories(parallax_core PUBLIC include ${GEN_DIR})
if(MSVC)
  # /utf-8: sources contain UTF-8 comments; /EHsc: standard exceptions;
  # silence the CRT "unsafe function" deprecations triggered by Flex output.
  target_compile_options(parallax_core PUBLIC /utf-8 /EHsc)
  target_compile_definitions(parallax_core PUBLIC _CRT_SECURE_NO_WARNINGS _CRT_NONSTDC_NO_DEPRECATE)
elseif(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
  target_compile_options(parallax_core PRIVATE -Wall -Wextra)
  # Flex/Bison generated code trips a few harmless warnings.
  set_source_files_properties(${FLEX_MiniCLexer_OUTPUTS} ${BISON_MiniCParser_OUTPUTS}
    PROPERTIES COMPILE_OPTIONS "-Wno-unused-function;-Wno-sign-compare;-Wno-unused-parameter")
endif()

add_executable(parallaxc src/main.cpp)
target_link_libraries(parallaxc PRIVATE parallax_core)
if(MINGW)
  # A MinGW/MSYS2 build would otherwise need libstdc++/libgcc DLLs on PATH
  # when the backend launches it from an ordinary Windows shell.
  target_link_options(parallaxc PRIVATE -static -static-libgcc -static-libstdc++)
endif()

enable_testing()
add_executable(parallax_tests tests/test_main.cpp tests/test_lexer.cpp tests/test_parser.cpp tests/test_repair.cpp)
find_package(Threads REQUIRED)
target_link_libraries(parallax_tests PRIVATE parallax_core Threads::Threads)
target_compile_definitions(parallax_tests PRIVATE PARALLAX_FIXTURES="${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures")
add_test(NAME parallax_unit COMMAND parallax_tests)
add_test(NAME parallaxc_version COMMAND parallaxc version)
